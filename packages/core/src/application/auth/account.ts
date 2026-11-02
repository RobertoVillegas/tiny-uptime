import { Result } from "better-result";
import type { AddPasskeyInput, Passkey } from "@tiny-uptime/contracts";
import { newTotpSecret, otpauthUri, verifyTotp } from "../../domain/auth/totp";
import { Invalid, NotFound, type TooManyAttempts, type Unauthorized } from "../../errors";
import { startChallenge, takeChallenge, type StartedChallenge } from "./challenges";
import type { AuthDeps } from "./deps";
import { passkeyLabel } from "./invites";
import { checkTotp } from "./sign-in";

export function accountSecurity(d: AuthDeps, userId: string): { totpEnabled: boolean; recoveryCodesLeft: number; passkeys: Passkey[] } {
  const user = d.users.get(userId);
  return {
    totpEnabled: Boolean(user?.totpSecret),
    recoveryCodesLeft: d.recoveryCodes.count(userId),
    passkeys: d.passkeys
      .forUser(userId)
      .map((p) => ({ id: p.id, name: p.name, createdAt: iso(p.createdAt), lastUsedAt: p.lastUsedAt === null ? null : iso(p.lastUsedAt) })),
  };
}

// ---- passkeys ----

export function startAddPasskey(
  d: AuthDeps,
  user: { userId: string; email: string; name: string },
): StartedChallenge & { user: { id: string; name: string; displayName: string } } {
  return { ...startChallenge(d, "add-passkey", user.userId), user: { id: user.userId, name: user.email, displayName: user.name } };
}

export async function addPasskey(d: AuthDeps, userId: string, input: AddPasskeyInput): Promise<Result<void, Invalid>> {
  return Result.gen(async function* () {
    const challenge = yield* takeChallenge(d, input.challengeId, "add-passkey", userId);
    const passkey = yield* Result.await(d.verifier.verifyRegistration(input.registration, challenge));
    d.passkeys.insert({
      ...passkey,
      userId,
      name: passkeyLabel(input.label, passkey.authenticatorName),
      createdAt: d.clock.now(),
      lastUsedAt: null,
    });
    return Result.ok(undefined);
  });
}

/** The last passkey cannot be removed: it would lock the user out. */
export function removePasskey(d: AuthDeps, userId: string, id: string): Result<void, Invalid | NotFound> {
  if (d.passkeys.forUser(userId).length <= 1)
    return Result.err(new Invalid({ field: "id", message: "you cannot remove your only passkey" }));
  return d.passkeys.delete(id, userId) ? Result.ok(undefined) : Result.err(new NotFound({ message: "passkey not found" }));
}

// ---- TOTP ----

/** Starts enabling TOTP; it is only active after the user confirms a code from their app. */
export function startTotp(d: AuthDeps, userId: string): Result<{ secret: string; uri: string }, NotFound> {
  const user = d.users.get(userId);
  if (!user) return Result.err(new NotFound({ message: "user not found" }));
  const secret = newTotpSecret();
  d.users.save({ ...user, totpPending: secret });
  return Result.ok({ secret, uri: otpauthUri(secret, user.email, "tiny-uptime") });
}

export async function confirmTotp(d: AuthDeps, userId: string, code: string): Promise<Result<void, Invalid>> {
  const user = d.users.get(userId);
  const step = user?.totpPending ? await verifyTotp(user.totpPending, code, d.clock.now(), null) : null;
  if (!user || step === null) return Result.err(new Invalid({ field: "code", message: "invalid code" }));
  d.users.save({ ...user, totpSecret: user.totpPending, totpPending: null, totpLastStep: step });
  return Result.ok(undefined);
}

export async function disableTotp(d: AuthDeps, userId: string, code: string): Promise<Result<void, Unauthorized | TooManyAttempts>> {
  return (await checkTotp(d, userId, code)).map((user) => d.users.save({ ...user, totpSecret: null, totpLastStep: null }));
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
