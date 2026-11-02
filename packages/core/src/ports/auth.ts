import type { Result } from "better-result";
import type { Membership, Role } from "@tiny-uptime/contracts";
import type { Challenge, Invite, Session, StoredPasskey, User } from "../domain/auth/user";
import type { Invalid, Unauthorized } from "../errors";

export interface UserRepository {
  get(id: string): User | null;
  byEmail(email: string): User | null;
  insert(user: User): void;
  save(user: User): void;
}

export interface PasskeyRepository {
  get(id: string): StoredPasskey | null;
  forUser(userId: string): StoredPasskey[];
  insert(passkey: StoredPasskey): void;
  recordUse(id: string, counter: number, at: number): void;
  delete(id: string, userId: string): boolean;
}

export interface SessionRepository {
  get(hash: string): Session | null;
  insert(session: Session): void;
  touch(hash: string, at: number): void;
  delete(hash: string): void;
  deleteOthers(userId: string, keepHash: string): void;
  purgeExpired(now: number): void;
}

export interface ChallengeRepository {
  insert(challenge: Challenge): void;
  /** Reads and deletes: a challenge is used once. */
  take(id: string): Challenge | null;
  purgeExpired(now: number): void;
}

export interface InviteRepository {
  insert(invite: Invite): void;
  get(hash: string): Invite | null;
  delete(hash: string): void;
  pending(workspaceId: string, now: number): Invite[];
}

export interface MembershipRepository {
  forUser(userId: string): Membership[];
  forWorkspace(workspaceId: string): { userId: string; email: string; name: string; role: Role }[];
  get(userId: string, workspaceId: string): Membership | null;
  upsert(userId: string, membership: Membership): void;
  setRole(userId: string, workspaceId: string, role: Role): void;
  delete(userId: string, workspaceId: string): void;
  countOwners(workspaceId: string): number;
}

export interface RecoveryCodeRepository {
  replace(userId: string, hashes: string[]): void;
  /** Deletes the code if it exists; true when it did. */
  consume(userId: string, hash: string): boolean;
  count(userId: string): number;
}

export type NewPasskey = Pick<StoredPasskey, "id" | "publicKey" | "algorithm" | "transports" | "counter"> & { authenticatorName: string | null };

/** Checks WebAuthn ceremonies against the expected challenge and this site's origin. */
export interface PasskeyVerifier {
  newChallenge(): string;
  verifyRegistration(registration: unknown, challenge: string): Promise<Result<NewPasskey, Invalid>>;
  verifyAuthentication(authentication: unknown, passkey: StoredPasskey, challenge: string): Promise<Result<{ counter: number }, Unauthorized>>;
}
