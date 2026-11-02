import { server } from "@passwordless-id/webauthn";
import type { AuthenticationJSON, RegistrationJSON } from "@passwordless-id/webauthn/dist/esm/types";
import type { Env } from "../env";
import { sha256Hex } from "../lib/ids";
import { asObject, InvalidInput, oneOf, str, type Input } from "../lib/validate";
import { otpauthUri } from "./totp";
import { ROLES, SESSION_TTL_MS, type AuthStore, type Role, type SessionInfo } from "./store";

const COOKIE = "__Host-tu_session";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ctx = { request: Request; env: Env; url: URL; store: DurableObjectStub<AuthStore> };

export function authStore(env: Env): DurableObjectStub<AuthStore> {
  return env.AUTH.get(env.AUTH.idFromName("auth"));
}

// ---- sessions, shared with the API ----

/** Session lookups are cached briefly per isolate, so a burst of panel requests costs one lookup. */
const sessionCache = new Map<string, { info: SessionInfo | null; until: number }>();
const SESSION_CACHE_MS = 30_000;

export async function currentSession(request: Request, env: Env): Promise<{ hash: string; info: SessionInfo } | null> {
  const token = readCookie(request, COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const hash = await sha256Hex(token);
  const now = Date.now();
  const cached = sessionCache.get(hash);
  let info: SessionInfo | null;
  if (cached && cached.until > now) info = cached.info;
  else {
    info = await authStore(env).session(hash);
    if (sessionCache.size > 1000) sessionCache.clear();
    sessionCache.set(hash, { info, until: now + SESSION_CACHE_MS });
  }
  return info ? { hash, info } : null;
}

/**
 * Cookie-authenticated writes must come from our own pages. SameSite=Lax already blocks most
 * cross-site requests; checking Origin and requiring a JSON body closes the rest.
 */
export function sameOrigin(request: Request, url: URL): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  return request.headers.get("origin") === url.origin;
}

// ---- routes ----

export async function handleAuth(request: Request, env: Env, url: URL, readJson: () => Promise<unknown>): Promise<Response> {
  if (!sameOrigin(request, url)) return json(403, { error: "cross-origin request refused" });
  const ctx: Ctx = { request, env, url, store: authStore(env) };
  const path = url.pathname.slice("/auth".length);
  const method = request.method;
  const body = async (): Promise<Input> => asObject(await readJson());

  // Invitations and sign-up
  if (path === "/invite" && method === "GET") {
    const invite = await ctx.store.invite(url.searchParams.get("token") ?? "");
    return invite ? json(200, invite) : json(404, { error: "invite is invalid or expired" });
  }
  if (path === "/invite/options" && method === "POST") return inviteOptions(ctx, await body());
  if (path === "/invite/complete" && method === "POST") return inviteComplete(ctx, await body());

  // Sign-in
  if (path === "/login/options" && method === "POST") {
    const challenge = server.randomChallenge();
    const challengeId = await ctx.store.createChallenge(challenge, "login", null);
    return json(200, { challengeId, challenge });
  }
  if (path === "/login/complete" && method === "POST") return loginComplete(ctx, await body());
  if (path === "/recovery" && method === "POST") {
    const input = await body();
    const result = await ctx.store.signInWithRecoveryCode(str(input, "email", { max: 200 }), str(input, "code", { max: 40 }));
    if ("error" in result) return json(401, result);
    return withSession(json(200, { stage: "full", addPasskey: true }), result.session);
  }

  const session = await currentSession(request, env);
  if (path === "/mfa" && method === "POST") {
    if (!session || session.info.stage !== "mfa") return json(401, { error: "no sign-in is waiting for a code" });
    const result = await ctx.store.completeMfa(session.hash, str(await body(), "code", { max: 10 }));
    sessionCache.delete(session.hash);
    if ("error" in result) return json(401, result);
    return withSession(json(200, { stage: "full" }), result.session);
  }
  if (path === "/logout" && method === "POST") {
    if (session) {
      await ctx.store.endSession(session.hash);
      sessionCache.delete(session.hash);
    }
    return clearSession(json(200, { ok: true }));
  }

  // Everything below needs a complete sign-in.
  if (!session || session.info.stage !== "full") return json(401, { error: "sign in first" });
  const { userId } = session.info;

  if (path === "/me" && method === "GET") {
    const profile = await ctx.store.profile(userId);
    return json(200, { ...session.info, ...profile, passkeys: await ctx.store.listPasskeys(userId) });
  }
  if (path === "/invite/accept" && method === "POST") {
    const result = await ctx.store.acceptInvite(str(await body(), "token", { max: 100 }), userId);
    sessionCache.delete(session.hash);
    return "error" in result ? json(400, result) : json(200, result);
  }
  if (path === "/sessions/others" && method === "DELETE") {
    await ctx.store.endOtherSessions(userId, session.hash);
    return json(200, { ok: true });
  }

  if (path === "/passkeys/options" && method === "POST") {
    const challenge = server.randomChallenge();
    const challengeId = await ctx.store.createChallenge(challenge, "add-passkey", userId);
    return json(200, { challengeId, challenge, user: { id: userId, name: session.info.email, displayName: session.info.name } });
  }
  if (path === "/passkeys" && method === "POST") {
    const input = await body();
    const challenge = await ctx.store.takeChallenge(str(input, "challengeId", { max: 40 }), "add-passkey");
    if (!challenge || challenge.subject !== userId) return json(400, { error: "challenge is invalid or expired" });
    const passkey = await verifyNewPasskey(ctx, input, challenge.value);
    if ("error" in passkey) return json(400, passkey);
    await ctx.store.addPasskey(userId, passkey);
    return json(201, { ok: true });
  }
  const removePasskey = /^\/passkeys\/([A-Za-z0-9_-]{1,1024})$/.exec(path);
  if (removePasskey && method === "DELETE") {
    const result = await ctx.store.removePasskey(userId, removePasskey[1]!);
    return "error" in result ? json(400, result) : json(200, result);
  }

  if (path === "/totp/setup" && method === "POST") {
    const secret = await ctx.store.startTotp(userId);
    if (!secret) return json(404, { error: "user not found" });
    return json(200, { secret, uri: otpauthUri(secret, session.info.email, "tiny-uptime") });
  }
  if (path === "/totp/confirm" && method === "POST") {
    const ok = await ctx.store.confirmTotp(userId, str(await body(), "code", { max: 10 }));
    return ok ? json(200, { ok: true }) : json(400, { error: "invalid code" });
  }
  if (path === "/totp/disable" && method === "POST") {
    const ok = await ctx.store.disableTotp(userId, str(await body(), "code", { max: 10 }));
    return ok ? json(200, { ok: true }) : json(400, { error: "invalid code" });
  }
  if (path === "/recovery-codes" && method === "POST") return json(200, { codes: await ctx.store.replaceRecoveryCodes(userId) });

  // Workspace members, for owners
  const members = /^\/workspaces\/([a-z2-7]{12})\/(members|invites)(?:\/([a-z2-7]{12}))?$/.exec(path);
  if (members) {
    const [, workspaceId, kind, memberId] = members as unknown as [string, string, string, string | undefined];
    const membership = session.info.memberships.find((m) => m.workspaceId === workspaceId);
    if (!membership) return json(404, { error: "workspace not found" });
    if (kind === "members" && !memberId && method === "GET") {
      return json(200, { members: await ctx.store.members(workspaceId), invites: await ctx.store.pendingInvites(workspaceId) });
    }
    if (membership.role !== "owner") return json(403, { error: "only owners manage members" });
    if (kind === "invites" && !memberId && method === "POST") {
      const input = await body();
      const email = str(input, "email", { max: 200, pattern: EMAIL });
      const role = oneOf(input, "role", ROLES, "viewer");
      const token = await ctx.store.createInvite(email, workspaceId, membership.workspaceName, role);
      return json(201, { inviteUrl: `${url.origin}/app/invite?token=${token}`, email, role });
    }
    if (kind === "members" && memberId && (method === "PATCH" || method === "DELETE")) {
      const role: Role | null = method === "DELETE" ? null : oneOf(await body(), "role", ROLES);
      const result = await ctx.store.setRole(workspaceId, memberId, role);
      return "error" in result ? json(400, result) : json(200, result);
    }
  }

  return json(404, { error: "not found" });
}

async function inviteOptions(ctx: Ctx, input: Input): Promise<Response> {
  const token = str(input, "token", { max: 100 });
  const invite = await ctx.store.invite(token);
  if (!invite) return json(404, { error: "invite is invalid or expired" });
  if (invite.existingUser) return json(409, { error: "this email already has an account; sign in to accept the invite" });
  const challenge = server.randomChallenge();
  const challengeId = await ctx.store.createChallenge(challenge, "sign-up", await sha256Hex(token));
  return json(200, { challengeId, challenge, user: { name: invite.email, displayName: str(input, "name", { max: 100 }) } });
}

async function inviteComplete(ctx: Ctx, input: Input): Promise<Response> {
  const token = str(input, "token", { max: 100 });
  const challenge = await ctx.store.takeChallenge(str(input, "challengeId", { max: 40 }), "sign-up");
  if (!challenge || challenge.subject !== (await sha256Hex(token))) return json(400, { error: "challenge is invalid or expired" });
  const passkey = await verifyNewPasskey(ctx, input, challenge.value);
  if ("error" in passkey) return json(400, passkey);
  const result = await ctx.store.signUpWithInvite(token, str(input, "name", { max: 100 }), passkey);
  if ("error" in result) return json(400, result);
  return withSession(json(201, { stage: "full", recoveryCodes: result.recoveryCodes }), result.session);
}

async function loginComplete(ctx: Ctx, input: Input): Promise<Response> {
  const challenge = await ctx.store.takeChallenge(str(input, "challengeId", { max: 40 }), "login");
  if (!challenge) return json(400, { error: "challenge is invalid or expired" });
  const authentication = asObject(input.authentication, "authentication") as unknown as AuthenticationJSON;
  if (typeof authentication.id !== "string") throw new InvalidInput("authentication", "is not a passkey response");
  const passkey = await ctx.store.passkey(authentication.id);
  if (!passkey) return json(401, { error: "this passkey is not registered" });
  try {
    const result = await server.verifyAuthentication(
      authentication,
      { id: passkey.id, publicKey: passkey.publicKey, algorithm: passkey.algorithm, transports: passkey.transports as never },
      { challenge: challenge.value, origin: ctx.url.origin, userVerified: true, counter: passkey.counter },
    );
    const session = await ctx.store.signInWithPasskey(passkey.id, result.counter);
    if ("error" in session) return json(401, session);
    return withSession(json(200, { stage: session.stage }), session.session);
  } catch (error) {
    console.warn("passkey sign-in refused", error instanceof Error ? error.message : error);
    return json(401, { error: "passkey verification failed" });
  }
}

async function verifyNewPasskey(ctx: Ctx, input: Input, challenge: string) {
  const registration = asObject(input.registration, "registration") as unknown as RegistrationJSON;
  const label = str(input, "label", { max: 60, optional: true }) ?? "Passkey";
  try {
    const info = await server.verifyRegistration(registration, { challenge, origin: ctx.url.origin, userVerified: true });
    return {
      id: info.credential.id,
      publicKey: info.credential.publicKey,
      algorithm: info.credential.algorithm,
      transports: info.credential.transports,
      counter: info.authenticator.counter,
      label: info.authenticator.name && info.authenticator.name !== "Unknown" ? `${label} (${info.authenticator.name})` : label,
    };
  } catch (error) {
    console.warn("passkey registration refused", error instanceof Error ? error.message : error);
    return { error: "passkey verification failed" };
  }
}

// ---- cookies ----

function withSession(res: Response, token: string): Response {
  res.headers.append("set-cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`);
  return res;
}

function clearSession(res: Response): Response {
  res.headers.append("set-cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return res;
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
