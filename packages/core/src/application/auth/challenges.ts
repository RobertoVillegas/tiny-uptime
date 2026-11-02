import { Result } from "better-result";
import { AUTH_POLICY, type ChallengePurpose } from "../../domain/auth/user";
import { Invalid } from "../../errors";
import type { AuthDeps } from "./deps";

export type StartedChallenge = { challengeId: string; challenge: string };

export function startChallenge(d: AuthDeps, purpose: ChallengePurpose, subject: string | null): StartedChallenge {
  const now = d.clock.now();
  d.challenges.purgeExpired(now);
  const challenge = d.verifier.newChallenge();
  const challengeId = d.ids.id(16);
  d.challenges.insert({ id: challengeId, value: challenge, purpose, subject, expiresAt: now + AUTH_POLICY.challengeTtlMs });
  return { challengeId, challenge };
}

/** Takes a challenge for this purpose and subject; it cannot be used again either way. */
export function takeChallenge(d: AuthDeps, id: string, purpose: ChallengePurpose, subject: string | null): Result<string, Invalid> {
  const challenge = d.challenges.take(id);
  const valid = challenge && challenge.purpose === purpose && challenge.expiresAt >= d.clock.now() && challenge.subject === subject;
  return valid ? Result.ok(challenge.value) : Result.err(new Invalid({ field: "challengeId", message: "challenge is invalid or expired" }));
}
