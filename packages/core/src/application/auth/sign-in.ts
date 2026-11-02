import { Result } from "better-result";
import type { LoginCompleteInput, SignInStage } from "@tiny-uptime/contracts";
import { verifyTotp } from "../../domain/auth/totp";
import { afterFailure, isLocked, type User } from "../../domain/auth/user";
import { TooManyAttempts, Unauthorized, type Invalid } from "../../errors";
import { startChallenge, takeChallenge, type StartedChallenge } from "./challenges";
import type { AuthDeps } from "./deps";
import { openSession } from "./sessions";

export function startSignIn(d: AuthDeps): StartedChallenge {
  return startChallenge(d, "login", null);
}

/** Verifies the passkey; users with TOTP get a session that waits for their code. */
export async function completeSignIn(
  d: AuthDeps,
  input: LoginCompleteInput,
): Promise<Result<{ session: string; stage: SignInStage }, Invalid | Unauthorized>> {
  return Result.gen(async function* () {
    const challenge = yield* takeChallenge(d, input.challengeId, "login", null);
    const passkey = d.passkeys.get(input.authentication.id);
    if (!passkey) return Result.err(new Unauthorized({ message: "this passkey is not registered" }));
    const { counter } = yield* Result.await(d.verifier.verifyAuthentication(input.authentication, passkey, challenge));
    const user = d.users.get(passkey.userId);
    if (!user) return Result.err(new Unauthorized({ message: "this passkey is not registered" }));

    d.passkeys.recordUse(passkey.id, counter, d.clock.now());
    const stage: SignInStage = user.totpSecret ? "mfa" : "full";
    return Result.ok({ session: await openSession(d, user.id, stage), stage });
  });
}

/** Finishes a sign-in waiting for its TOTP code. The waiting session is replaced, never upgraded. */
export async function completeMfa(
  d: AuthDeps,
  sessionHash: string,
  code: string,
): Promise<Result<{ session: string }, Unauthorized | TooManyAttempts>> {
  return Result.gen(async function* () {
    const session = d.sessions.get(sessionHash);
    if (!session || session.stage !== "mfa" || session.expiresAt < d.clock.now()) {
      return Result.err(new Unauthorized({ message: "no sign-in is waiting for a code" }));
    }
    yield* Result.await(checkTotp(d, session.userId, code));
    d.sessions.delete(sessionHash);
    return Result.ok({ session: await openSession(d, session.userId, "full") });
  });
}

/** A recovery code stands in for both factors once, so someone who lost their passkey can add a new one. */
export async function recoverAccount(
  d: AuthDeps,
  email: string,
  code: string,
): Promise<Result<{ session: string }, Unauthorized | TooManyAttempts>> {
  const user = d.users.byEmail(email.toLowerCase());
  const invalid = new Unauthorized({ message: "invalid email or recovery code" });
  if (!user) return Result.err(invalid);
  const now = d.clock.now();
  if (isLocked(user, now)) return Result.err(new TooManyAttempts({ message: "too many attempts; try again later" }));
  if (!d.recoveryCodes.consume(user.id, await d.ids.hash(code.trim().toLowerCase()))) {
    d.users.save({ ...user, ...afterFailure(user, now) });
    return Result.err(invalid);
  }
  d.users.save({ ...user, failures: 0, lockedUntil: null });
  return Result.ok({ session: await openSession(d, user.id, "full") });
}

/** Checks a TOTP code once per step, counting failures toward a temporary lock. */
export async function checkTotp(d: AuthDeps, userId: string, code: string): Promise<Result<User, Unauthorized | TooManyAttempts>> {
  const user = d.users.get(userId);
  if (!user?.totpSecret) return Result.err(new Unauthorized({ message: "two-step verification is not enabled" }));
  const now = d.clock.now();
  if (isLocked(user, now)) return Result.err(new TooManyAttempts({ message: "too many attempts; try again later" }));
  const step = await verifyTotp(user.totpSecret, code, now, user.totpLastStep);
  if (step === null) {
    d.users.save({ ...user, ...afterFailure(user, now) });
    return Result.err(new Unauthorized({ message: "invalid code" }));
  }
  const updated = { ...user, totpLastStep: step, failures: 0, lockedUntil: null };
  d.users.save(updated);
  return Result.ok(updated);
}
