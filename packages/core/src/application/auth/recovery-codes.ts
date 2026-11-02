import { AUTH_POLICY } from "../../domain/auth/user";
import type { AuthDeps } from "./deps";

/** Replaces a user's recovery codes; the plain codes are returned once and only hashes are kept. */
export async function issueRecoveryCodes(d: AuthDeps, userId: string): Promise<string[]> {
  const codes = Array.from({ length: AUTH_POLICY.recoveryCodes }, () => `${d.ids.id(5)}-${d.ids.id(5)}`);
  d.recoveryCodes.replace(userId, await Promise.all(codes.map((c) => d.ids.hash(c))));
  return codes;
}
