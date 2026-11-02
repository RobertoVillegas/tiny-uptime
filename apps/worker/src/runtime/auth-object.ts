import { DurableObject } from "cloudflare:workers";
import { Result } from "better-result";
import type { AddPasskeyInput, ClientRegistrationInput, InviteCompleteInput, LoginCompleteInput, Role } from "@tiny-uptime/contracts";
import { accounts } from "@tiny-uptime/core";
import { AUTH_SCHEMA } from "../adapters/sqlite/auth/schema";
import { SqliteMemberships, SqliteInvites, SqliteRecoveryCodes } from "../adapters/sqlite/auth/memberships";
import { SqliteOAuthClients, SqliteOAuthGrants } from "../adapters/sqlite/auth/oauth";
import { SqlitePasskeys } from "../adapters/sqlite/auth/passkeys";
import { SqliteChallenges, SqliteSessions } from "../adapters/sqlite/auth/sessions";
import { SqliteUsers } from "../adapters/sqlite/auth/users";
import { cryptoIds, systemClock } from "../adapters/system";
import { passkeyVerifier } from "../adapters/webauthn/verifier";
import type { Env } from "./env";
import { toWire } from "./wire";

/**
 * Accounts for the whole instance: users, passkeys, second factor, sessions, invites and memberships.
 * Workspaces never see credentials, only a user id and role. Passkey ceremonies are verified against
 * the origin the request came from.
 */
export class AuthStore extends DurableObject<Env> {
  private readonly repos: Omit<accounts.AuthDeps, "verifier">;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(AUTH_SCHEMA);
    this.repos = {
      clock: systemClock,
      ids: cryptoIds,
      users: new SqliteUsers(sql),
      passkeys: new SqlitePasskeys(sql),
      sessions: new SqliteSessions(sql),
      challenges: new SqliteChallenges(sql),
      invites: new SqliteInvites(sql),
      memberships: new SqliteMemberships(sql),
      recoveryCodes: new SqliteRecoveryCodes(sql),
      oauthClients: new SqliteOAuthClients(sql),
      oauthGrants: new SqliteOAuthGrants(sql),
    };
  }

  private deps(origin = ""): accounts.AuthDeps {
    return { ...this.repos, verifier: passkeyVerifier(origin) };
  }

  // ---- invites and sign-up ----

  createInvite(invite: { email: string; workspaceId: string; workspaceName: string; role: Role }) {
    return accounts.createInvite(this.deps(), invite);
  }

  async inviteInfo(token: string) {
    return toWire(await accounts.inviteInfo(this.deps(), token));
  }

  async startSignUp(origin: string, token: string, name: string) {
    return toWire(await accounts.startSignUp(this.deps(origin), token, name));
  }

  async completeSignUp(origin: string, input: InviteCompleteInput) {
    return toWire(await accounts.completeSignUp(this.deps(origin), input));
  }

  async acceptInvite(token: string, userId: string) {
    return toWire(await accounts.acceptInvite(this.deps(), token, userId));
  }

  // ---- sign-in ----

  startSignIn(origin: string) {
    return accounts.startSignIn(this.deps(origin));
  }

  async completeSignIn(origin: string, input: LoginCompleteInput) {
    return toWire(await accounts.completeSignIn(this.deps(origin), input));
  }

  async completeMfa(sessionHash: string, code: string) {
    return toWire(await accounts.completeMfa(this.deps(), sessionHash, code));
  }

  async recover(email: string, code: string) {
    return toWire(await accounts.recoverAccount(this.deps(), email, code));
  }

  // ---- sessions ----

  session(hash: string) {
    return accounts.resolveSession(this.deps(), hash);
  }

  endSession(hash: string) {
    accounts.endSession(this.deps(), hash);
  }

  endOtherSessions(userId: string, keepHash: string) {
    accounts.endOtherSessions(this.deps(), userId, keepHash);
  }

  // ---- account security ----

  security(userId: string) {
    return accounts.accountSecurity(this.deps(), userId);
  }

  startAddPasskey(origin: string, user: { userId: string; email: string; name: string }) {
    return accounts.startAddPasskey(this.deps(origin), user);
  }

  async addPasskey(origin: string, userId: string, input: AddPasskeyInput) {
    return toWire(await accounts.addPasskey(this.deps(origin), userId, input));
  }

  removePasskey(userId: string, id: string) {
    return toWire(accounts.removePasskey(this.deps(), userId, id));
  }

  startTotp(userId: string) {
    return toWire(accounts.startTotp(this.deps(), userId));
  }

  async confirmTotp(userId: string, code: string) {
    return toWire(await accounts.confirmTotp(this.deps(), userId, code));
  }

  async disableTotp(userId: string, code: string) {
    return toWire(await accounts.disableTotp(this.deps(), userId, code));
  }

  async issueRecoveryCodes(userId: string) {
    return toWire(Result.ok(await accounts.issueRecoveryCodes(this.deps(), userId)));
  }

  // ---- members ----

  listMembers(actor: accounts.Actor) {
    return accounts.listMembers(this.deps(), actor);
  }

  async inviteMember(actor: accounts.Actor, email: string, role: Role) {
    return toWire(await accounts.inviteMember(this.deps(), actor, email, role));
  }

  setMemberRole(actor: accounts.Actor, userId: string, role: Role | null) {
    return toWire(accounts.setMemberRole(this.deps(), actor, userId, role));
  }

  // ---- OAuth for MCP clients ----

  registerOAuthClient(input: ClientRegistrationInput) {
    return toWire(accounts.oauth.registerClient(this.deps(), input));
  }

  checkAuthorize(params: accounts.oauth.AuthorizeParams, resource: string) {
    const checked = accounts.oauth.checkAuthorize(this.deps(), params, resource);
    return checked.isOk() ? { ok: true as const, request: checked.value } : { ok: false as const, ...checked.error };
  }

  async approveOAuth(userId: string, workspaceId: string, request: accounts.oauth.AuthorizeRequest) {
    return toWire(await accounts.oauth.approve(this.deps(), userId, workspaceId, request));
  }

  async exchangeOAuthCode(p: { code: string; clientId: string; redirectUri: string; codeVerifier: string }) {
    const result = await accounts.oauth.exchangeCode(this.deps(), p);
    return result.isOk() ? { ok: true as const, tokens: result.value } : { ok: false as const, ...result.error };
  }

  async refreshOAuth(p: { refreshToken: string; clientId: string }) {
    const result = await accounts.oauth.refreshTokens(this.deps(), p);
    return result.isOk() ? { ok: true as const, tokens: result.value } : { ok: false as const, ...result.error };
  }

  oauthAccess(hash: string) {
    return accounts.oauth.resolveAccessToken(this.deps(), hash);
  }

  async revokeOAuthToken(token: string) {
    await accounts.oauth.revokeToken(this.deps(), token);
  }

  oauthGrants(userId: string) {
    return accounts.oauth.listGrants(this.deps(), userId);
  }

  revokeOAuthGrant(userId: string, id: string) {
    return toWire(accounts.oauth.revokeGrant(this.deps(), userId, id));
  }
}
