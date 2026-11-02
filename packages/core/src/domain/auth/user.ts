import type { Role } from "@tiny-uptime/contracts";

export type User = {
  id: string;
  email: string;
  name: string;
  totpSecret: string | null;
  totpPending: string | null;
  totpLastStep: number | null;
  failures: number;
  lockedUntil: number | null;
  createdAt: number;
};

export type StoredPasskey = {
  id: string;
  userId: string;
  publicKey: string;
  algorithm: "ES256" | "RS256" | "EdDSA";
  transports: string[];
  counter: number;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type Session = { hash: string; userId: string; stage: "full" | "mfa"; expiresAt: number; createdAt: number; seenAt: number };
export type Invite = {
  hash: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  expiresAt: number;
  createdAt: number;
};
export type Challenge = { id: string; value: string; purpose: ChallengePurpose; subject: string | null; expiresAt: number };
export type ChallengePurpose = "sign-up" | "login" | "add-passkey";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const AUTH_POLICY = {
  sessionTtlMs: 30 * DAY,
  mfaSessionTtlMs: 10 * MINUTE,
  challengeTtlMs: 5 * MINUTE,
  inviteTtlMs: 7 * DAY,
  /** Failed second-factor or recovery attempts before the account locks for a while. */
  maxFailures: 5,
  lockMs: 15 * MINUTE,
  recoveryCodes: 10,
  sessionTouchMs: 60 * MINUTE,
} as const;

export function isLocked(user: User, now: number): boolean {
  return user.lockedUntil !== null && user.lockedUntil > now;
}

/** Counts a failed attempt; returns the user's new failure counter and lock. */
export function afterFailure(user: User, now: number): Pick<User, "failures" | "lockedUntil"> {
  const failures = user.failures + 1;
  return failures >= AUTH_POLICY.maxFailures
    ? { failures: 0, lockedUntil: now + AUTH_POLICY.lockMs }
    : { failures, lockedUntil: user.lockedUntil };
}
