import type {
  ChallengeRepository,
  InviteRepository,
  MembershipRepository,
  PasskeyRepository,
  PasskeyVerifier,
  RecoveryCodeRepository,
  SessionRepository,
  UserRepository,
} from "../../ports/auth";
import type { Clock, Ids } from "../../ports/system";

/** Everything the account use cases need. The verifier is bound to the request's origin. */
export type AuthDeps = {
  clock: Clock;
  ids: Ids;
  users: UserRepository;
  passkeys: PasskeyRepository;
  sessions: SessionRepository;
  challenges: ChallengeRepository;
  invites: InviteRepository;
  memberships: MembershipRepository;
  recoveryCodes: RecoveryCodeRepository;
  verifier: PasskeyVerifier;
};
