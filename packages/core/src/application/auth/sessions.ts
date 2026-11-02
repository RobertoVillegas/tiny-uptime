import type { Membership } from "@tiny-uptime/contracts";
import { AUTH_POLICY, type Session } from "../../domain/auth/user";
import type { AuthDeps } from "./deps";

export type SessionInfo = { userId: string; email: string; name: string; stage: Session["stage"]; memberships: Membership[] };

/** Opens a session and returns its token; only the token's hash is stored. */
export async function openSession(d: AuthDeps, userId: string, stage: Session["stage"]): Promise<string> {
  const token = d.ids.secret(32);
  const now = d.clock.now();
  d.sessions.purgeExpired(now);
  const ttl = stage === "full" ? AUTH_POLICY.sessionTtlMs : AUTH_POLICY.mfaSessionTtlMs;
  d.sessions.insert({ hash: await d.ids.hash(token), userId, stage, expiresAt: now + ttl, createdAt: now, seenAt: now });
  return token;
}

export function resolveSession(d: AuthDeps, hash: string): SessionInfo | null {
  const session = d.sessions.get(hash);
  if (!session) return null;
  const now = d.clock.now();
  if (session.expiresAt < now) {
    d.sessions.delete(hash);
    return null;
  }
  if (now - session.seenAt > AUTH_POLICY.sessionTouchMs) d.sessions.touch(hash, now);
  const user = d.users.get(session.userId);
  if (!user) return null;
  return { userId: user.id, email: user.email, name: user.name, stage: session.stage, memberships: d.memberships.forUser(user.id) };
}

export function endSession(d: AuthDeps, hash: string): void {
  d.sessions.delete(hash);
}

export function endOtherSessions(d: AuthDeps, userId: string, keepHash: string): void {
  d.sessions.deleteOthers(userId, keepHash);
}
