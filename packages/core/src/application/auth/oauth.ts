import { Result } from "better-result";
import type { ClientRegistrationInput, OAuthGrantDto, OAuthScope } from "@tiny-uptime/contracts";
import {
  OAUTH_POLICY,
  parseScopes,
  redirectMatches,
  redirectUriProblem,
  tokenRole,
  type OAuthClient,
  type OAuthGrant,
} from "../../domain/auth/oauth";
import { Invalid, NotFound } from "../../errors";
import type { AuthDeps } from "./deps";

/** An error in OAuth's own vocabulary (RFC 6749 §4.1.2.1, §5.2). */
export type OAuthError = { error: string; description: string };
function oauthError<T>(error: string, description: string): Result<T, OAuthError> {
  return Result.err({ error, description });
}

export type AuthorizeParams = {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  scope: string | null;
  resource: string | null;
};

/** A checked authorization request, ready for the user to approve. */
export type AuthorizeRequest = { client: OAuthClient; redirectUri: string; codeChallenge: string; scopes: OAuthScope[]; resource: string };

export type TokenSet = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

export type TokenOwner = { userId: string; workspaceId: string; role: "owner" | "editor" | "viewer"; resource: string };

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export function registerClient(d: AuthDeps, input: ClientRegistrationInput): Result<OAuthClient, Invalid> {
  for (const uri of input.redirect_uris) {
    const problem = redirectUriProblem(uri);
    if (problem) return Result.err(new Invalid({ field: "redirect_uris", message: `${uri} ${problem}` }));
  }
  const now = d.clock.now();
  d.oauthClients.purgeUnused(now - OAUTH_POLICY.unusedClientTtlMs);
  const client: OAuthClient = { id: d.ids.id(24), name: input.client_name, redirectUris: input.redirect_uris, createdAt: now };
  d.oauthClients.insert(client);
  return Result.ok(client);
}

function fail(redirect: boolean, error: string, description: string): Result<never, OAuthError & { redirect: boolean }> {
  return Result.err({ error, description, redirect });
}

/**
 * Checks an authorization request. `redirect` says whether the error may be sent to the client's
 * redirect URI; until the client and its redirect URI check out, errors are shown to the user instead.
 */
export function checkAuthorize(
  d: AuthDeps,
  p: AuthorizeParams,
  ownResource: string,
): Result<AuthorizeRequest, OAuthError & { redirect: boolean }> {
  const client = p.clientId ? d.oauthClients.get(p.clientId) : null;
  if (!client) return fail(false, "invalid_client", "This app is not registered here. Ask it to connect again.");
  if (!p.redirectUri || !redirectMatches(client.redirectUris, p.redirectUri)) {
    return fail(false, "invalid_request", "This app asked to send you back to an address it did not register.");
  }
  if (p.responseType !== "code") return fail(true, "unsupported_response_type", "only response_type=code is supported");
  if (p.codeChallengeMethod !== "S256" || !p.codeChallenge || !CHALLENGE.test(p.codeChallenge)) {
    return fail(true, "invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  const scopes = parseScopes(p.scope);
  if (!scopes) return fail(true, "invalid_scope", "known scopes are mcp:read and mcp:write");
  if (p.resource && p.resource !== ownResource) return fail(true, "invalid_target", `the only resource here is ${ownResource}`);
  return Result.ok({ client, redirectUri: p.redirectUri, codeChallenge: p.codeChallenge, scopes, resource: ownResource });
}

/** The user said yes: records the grant and returns a one-time code for the client. */
export async function approve(
  d: AuthDeps,
  userId: string,
  workspaceId: string,
  request: AuthorizeRequest,
): Promise<Result<string, NotFound>> {
  const membership = d.memberships.get(userId, workspaceId);
  if (!membership) return Result.err(new NotFound({ message: "workspace not found" }));
  const now = d.clock.now();
  d.oauthGrants.purgeExpired(now);
  const grant: OAuthGrant = {
    id: d.ids.id(),
    clientId: request.client.id,
    userId,
    workspaceId,
    scopes: membership.role === "viewer" ? ["mcp:read"] : request.scopes,
    resource: request.resource,
    createdAt: now,
    lastUsedAt: null,
  };
  d.oauthGrants.insert(grant);
  const code = d.ids.secret(32);
  d.oauthGrants.insertCode({
    hash: await d.ids.hash(code),
    grantId: grant.id,
    clientId: request.client.id,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    expiresAt: now + OAUTH_POLICY.codeTtlMs,
  });
  return Result.ok(code);
}

export async function exchangeCode(
  d: AuthDeps,
  p: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
): Promise<Result<TokenSet, OAuthError>> {
  const code = d.oauthGrants.takeCode(await d.ids.hash(p.code));
  const now = d.clock.now();
  if (!code || code.expiresAt < now) return oauthError("invalid_grant", "the code is unknown, used or expired");
  if (code.clientId !== p.clientId) return oauthError("invalid_grant", "the code was issued to another client");
  if (code.redirectUri !== p.redirectUri) return oauthError("invalid_grant", "redirect_uri does not match the authorization request");
  if (!VERIFIER.test(p.codeVerifier) || (await d.ids.hashBase64Url(p.codeVerifier)) !== code.codeChallenge) {
    return oauthError("invalid_grant", "code_verifier does not match the code challenge");
  }
  const grant = d.oauthGrants.get(code.grantId);
  if (!grant) return oauthError("invalid_grant", "the authorization was revoked");
  return Result.ok(await issueTokens(d, grant));
}

/**
 * Trades a refresh token for a new pair. Refresh tokens rotate: presenting one that was already used
 * means it leaked, so the whole grant is revoked (OAuth 2.1 §4.3.1).
 */
export async function refreshTokens(d: AuthDeps, p: { refreshToken: string; clientId: string }): Promise<Result<TokenSet, OAuthError>> {
  const hash = await d.ids.hash(p.refreshToken);
  const token = d.oauthGrants.token(hash);
  const now = d.clock.now();
  if (!token || token.kind !== "refresh" || token.expiresAt < now)
    return oauthError("invalid_grant", "the refresh token is unknown or expired");
  const grant = d.oauthGrants.get(token.grantId);
  if (!grant || grant.clientId !== p.clientId) return oauthError("invalid_grant", "the refresh token belongs to another client");
  if (token.usedAt !== null) {
    d.oauthGrants.delete(grant.id);
    return oauthError("invalid_grant", "the refresh token was already used; sign in again");
  }
  d.oauthGrants.markUsed(hash, now);
  return Result.ok(await issueTokens(d, grant));
}

async function issueTokens(d: AuthDeps, grant: OAuthGrant): Promise<TokenSet> {
  const now = d.clock.now();
  const access = `tuat_${d.ids.secret(32)}`;
  const refresh = `turt_${d.ids.secret(32)}`;
  d.oauthGrants.insertToken({
    hash: await d.ids.hash(access),
    grantId: grant.id,
    kind: "access",
    expiresAt: now + OAUTH_POLICY.accessTtlMs,
    usedAt: null,
  });
  d.oauthGrants.insertToken({
    hash: await d.ids.hash(refresh),
    grantId: grant.id,
    kind: "refresh",
    expiresAt: now + OAUTH_POLICY.refreshTtlMs,
    usedAt: null,
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: OAUTH_POLICY.accessTtlMs / 1000,
    refresh_token: refresh,
    scope: grant.scopes.join(" "),
  };
}

/** Who an access token acts as, with the member's current role; null once expired, revoked or no longer a member. */
export function resolveAccessToken(d: AuthDeps, hash: string): TokenOwner | null {
  const token = d.oauthGrants.token(hash);
  const now = d.clock.now();
  if (!token || token.kind !== "access" || token.expiresAt < now) return null;
  const grant = d.oauthGrants.get(token.grantId);
  if (!grant) return null;
  const membership = d.memberships.get(grant.userId, grant.workspaceId);
  if (!membership) return null;
  if (grant.lastUsedAt === null || now - grant.lastUsedAt > OAUTH_POLICY.touchMs) d.oauthGrants.touch(grant.id, now);
  return { userId: grant.userId, workspaceId: grant.workspaceId, role: tokenRole(membership.role, grant.scopes), resource: grant.resource };
}

/** Token revocation (RFC 7009): either token ends the whole grant. Unknown tokens are not an error. */
export async function revokeToken(d: AuthDeps, token: string): Promise<void> {
  const found = d.oauthGrants.token(await d.ids.hash(token));
  if (found) d.oauthGrants.delete(found.grantId);
}

export function listGrants(d: AuthDeps, userId: string): OAuthGrantDto[] {
  const workspaces = new Map(d.memberships.forUser(userId).map((m) => [m.workspaceId, m.workspaceName]));
  return d.oauthGrants
    .forUser(userId)
    .filter((g) => workspaces.has(g.workspaceId))
    .map((g) => ({
      id: g.id,
      clientName: g.clientName,
      workspaceId: g.workspaceId,
      workspaceName: workspaces.get(g.workspaceId)!,
      scopes: g.scopes,
      createdAt: new Date(g.createdAt).toISOString(),
      lastUsedAt: g.lastUsedAt === null ? null : new Date(g.lastUsedAt).toISOString(),
    }));
}

export function revokeGrant(d: AuthDeps, userId: string, id: string): Result<void, NotFound> {
  const grant = d.oauthGrants.get(id);
  if (!grant || grant.userId !== userId) return Result.err(new NotFound({ message: "connected app not found" }));
  d.oauthGrants.delete(id);
  return Result.ok(undefined);
}
