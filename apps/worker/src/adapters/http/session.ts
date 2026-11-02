import type { accounts } from "@tiny-uptime/core";
import { cryptoIds } from "../system";
import type { Env } from "../../runtime/env";
import { bearer, readCookie } from "./request";

export const SESSION_COOKIE = "__Host-tu_session";
const SESSION_MAX_AGE_S = 30 * 24 * 3600;
const CACHE_MS = 30_000;

export type CurrentSession = { hash: string; info: accounts.SessionInfo };

export function authStore(env: Env) {
  return env.AUTH.get(env.AUTH.idFromName("auth"));
}

/** Lookups are cached for a few seconds per isolate, so a burst of panel requests costs one. */
const cache = new Map<string, { info: accounts.SessionInfo | null; until: number }>();

export async function currentSession(request: Request, env: Env): Promise<CurrentSession | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const hash = await cryptoIds.hash(token);
  const now = Date.now();
  const cached = cache.get(hash);
  let info = cached && cached.until > now ? cached.info : undefined;
  if (info === undefined) {
    info = await authStore(env).session(hash);
    if (cache.size > 1000) cache.clear();
    cache.set(hash, { info, until: now + CACHE_MS });
  }
  return info ? { hash, info } : null;
}

export function forgetSession(hash: string): void {
  cache.delete(hash);
}

/** A complete sign-in, not one still waiting for its second factor. */
export async function signedIn(request: Request, env: Env): Promise<CurrentSession | null> {
  const session = await currentSession(request, env);
  return session?.info.stage === "full" ? session : null;
}

export function withSession(res: Response, token: string): Response {
  res.headers.append("set-cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}`);
  return res;
}

export function clearSession(res: Response): Response {
  res.headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return res;
}

/**
 * Cookie-authenticated writes must come from our own pages. SameSite=Lax blocks most cross-site
 * requests; checking Origin closes the rest.
 */
export function sameOrigin(request: Request, url: URL): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  return request.headers.get("origin") === url.origin;
}

export async function isOperator(request: Request, env: Env): Promise<boolean> {
  const given = bearer(request);
  if (!env.ADMIN_TOKEN || !given) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(env.ADMIN_TOKEN)),
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}
