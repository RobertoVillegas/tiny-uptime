import * as v from "valibot";

export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const email = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(200), v.regex(EMAIL, "must be an email address"));
const token = v.pipe(v.string(), v.maxLength(100));
const challengeId = v.pipe(v.string(), v.maxLength(40));
const displayName = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100));
const label = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60)));
/** WebAuthn JSON as the browser produces it; the passkey verifier checks its contents. */
const webauthnJson = v.looseObject({ id: v.string(), response: v.looseObject({}) });

export const InviteOptionsInput = v.object({ token, name: displayName });
export const InviteCompleteInput = v.object({ token, name: displayName, challengeId, registration: webauthnJson, label });
export const LoginCompleteInput = v.object({ challengeId, authentication: webauthnJson });
export const AddPasskeyInput = v.object({ challengeId, registration: webauthnJson, label });
export const CodeInput = v.object({ code: v.pipe(v.string(), v.trim(), v.maxLength(10)) });
export const RecoveryInput = v.object({ email, code: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(40)) });
export const TokenInput = v.object({ token });
export const InviteMemberInput = v.object({ email, role: v.optional(v.picklist(ROLES), "viewer") });
export const RoleInput = v.object({ role: v.picklist(ROLES) });

export type InviteCompleteInput = v.InferOutput<typeof InviteCompleteInput>;
export type LoginCompleteInput = v.InferOutput<typeof LoginCompleteInput>;
export type AddPasskeyInput = v.InferOutput<typeof AddPasskeyInput>;
export type RecoveryInput = v.InferOutput<typeof RecoveryInput>;

export type Membership = { workspaceId: string; workspaceName: string; role: Role };
export type Passkey = { id: string; name: string; createdAt: string; lastUsedAt: string | null };
export type Me = {
  userId: string;
  email: string;
  name: string;
  stage: "full";
  memberships: Membership[];
  totpEnabled: boolean;
  recoveryCodesLeft: number;
  passkeys: Passkey[];
};
export type InviteInfo = { email: string; workspaceName: string; role: Role; existingUser: boolean };
export type Member = { userId: string; email: string; name: string; role: Role };
export type PendingInvite = { email: string; role: Role; expiresAt: string };
/** Sign-in finishes in one step, or waits for a TOTP code when the user enabled one. */
export type SignInStage = "full" | "mfa";
