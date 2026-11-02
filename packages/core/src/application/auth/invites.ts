import { Result } from "better-result";
import type { InviteCompleteInput, InviteInfo, Membership, Role } from "@tiny-uptime/contracts";
import { AUTH_POLICY, type Invite } from "../../domain/auth/user";
import { Conflict, Invalid, NotFound } from "../../errors";
import { startChallenge, takeChallenge, type StartedChallenge } from "./challenges";
import type { AuthDeps } from "./deps";
import { issueRecoveryCodes } from "./recovery-codes";
import { openSession } from "./sessions";

const ALREADY_REGISTERED = "this email already has an account; sign in to accept the invite";

export async function createInvite(
  d: AuthDeps,
  invite: { email: string; workspaceId: string; workspaceName: string; role: Role },
): Promise<string> {
  const token = d.ids.secret(24);
  const now = d.clock.now();
  d.invites.insert({
    ...invite,
    email: invite.email.toLowerCase(),
    hash: await d.ids.hash(token),
    expiresAt: now + AUTH_POLICY.inviteTtlMs,
    createdAt: now,
  });
  return token;
}

export async function inviteInfo(d: AuthDeps, token: string): Promise<Result<InviteInfo, NotFound>> {
  return (await findInvite(d, token)).map((invite) => ({
    email: invite.email,
    workspaceName: invite.workspaceName,
    role: invite.role,
    existingUser: d.users.byEmail(invite.email) !== null,
  }));
}

/** First step of signing up: a WebAuthn challenge tied to this invite. */
export async function startSignUp(
  d: AuthDeps,
  token: string,
  name: string,
): Promise<Result<StartedChallenge & { user: { name: string; displayName: string } }, NotFound | Conflict>> {
  return Result.gen(async function* () {
    const invite = yield* Result.await(findInvite(d, token));
    if (d.users.byEmail(invite.email)) return Result.err(new Conflict({ message: ALREADY_REGISTERED }));
    return Result.ok({ ...startChallenge(d, "sign-up", invite.hash), user: { name: invite.email, displayName: name } });
  });
}

/** Creates the account with its first passkey, joins the invited workspace and signs in. */
export async function completeSignUp(
  d: AuthDeps,
  input: InviteCompleteInput,
): Promise<Result<{ session: string; recoveryCodes: string[] }, Invalid | NotFound | Conflict>> {
  return Result.gen(async function* () {
    const invite = yield* Result.await(findInvite(d, input.token));
    const challenge = yield* takeChallenge(d, input.challengeId, "sign-up", invite.hash);
    const passkey = yield* Result.await(d.verifier.verifyRegistration(input.registration, challenge));
    if (d.users.byEmail(invite.email)) return Result.err(new Conflict({ message: ALREADY_REGISTERED }));

    const now = d.clock.now();
    const userId = d.ids.id();
    d.users.insert({
      id: userId,
      email: invite.email,
      name: input.name,
      totpSecret: null,
      totpPending: null,
      totpLastStep: null,
      failures: 0,
      lockedUntil: null,
      createdAt: now,
    });
    d.memberships.upsert(userId, { workspaceId: invite.workspaceId, workspaceName: invite.workspaceName, role: invite.role });
    d.passkeys.insert({ ...passkey, userId, name: passkeyLabel(input.label, passkey.authenticatorName), createdAt: now, lastUsedAt: null });
    d.invites.delete(invite.hash);
    const recoveryCodes = await issueRecoveryCodes(d, userId);
    return Result.ok({ session: await openSession(d, userId, "full"), recoveryCodes });
  });
}

/** A signed-in user joins another workspace with an invite sent to their email. */
export async function acceptInvite(d: AuthDeps, token: string, userId: string): Promise<Result<Membership, NotFound | Invalid>> {
  return Result.gen(async function* () {
    const invite = yield* Result.await(findInvite(d, token));
    const user = d.users.get(userId);
    if (!user || user.email !== invite.email)
      return Result.err(new Invalid({ field: "token", message: "this invite is for another email" }));
    const membership: Membership = { workspaceId: invite.workspaceId, workspaceName: invite.workspaceName, role: invite.role };
    d.memberships.upsert(userId, membership);
    d.invites.delete(invite.hash);
    return Result.ok(membership);
  });
}

export function passkeyLabel(label: string | undefined, authenticator: string | null): string {
  const base = label || "Passkey";
  return authenticator ? `${base} (${authenticator})` : base;
}

async function findInvite(d: AuthDeps, token: string): Promise<Result<Invite, NotFound>> {
  const invite = d.invites.get(await d.ids.hash(token));
  return invite && invite.expiresAt > d.clock.now()
    ? Result.ok(invite)
    : Result.err(new NotFound({ message: "invite is invalid or expired" }));
}
