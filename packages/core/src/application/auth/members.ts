import { Result } from "better-result";
import type { Member, Membership, PendingInvite, Role } from "@tiny-uptime/contracts";
import { roleAllows } from "../../domain/access";
import { Forbidden, Invalid, NotFound } from "../../errors";
import type { AuthDeps } from "./deps";
import { createInvite } from "./invites";

/** A signed-in user's standing in one workspace: who they are there, and what they may do. */
export type Actor = { userId: string; membership: Membership };

export function listMembers(d: AuthDeps, actor: Actor): { members: Member[]; invites: PendingInvite[] } {
  const workspaceId = actor.membership.workspaceId;
  return {
    members: d.memberships.forWorkspace(workspaceId),
    invites: d.invites
      .pending(workspaceId, d.clock.now())
      .map((i) => ({ email: i.email, role: i.role, expiresAt: new Date(i.expiresAt).toISOString() })),
  };
}

export async function inviteMember(d: AuthDeps, actor: Actor, email: string, role: Role): Promise<Result<string, Forbidden>> {
  if (!roleAllows(actor.membership.role, "manage-members")) return Result.err(new Forbidden({ message: "only owners manage members" }));
  const { workspaceId, workspaceName } = actor.membership;
  return Result.ok(await createInvite(d, { email, workspaceId, workspaceName, role }));
}

/** Changes or removes a member, refusing to leave a workspace without an owner. */
export function setMemberRole(d: AuthDeps, actor: Actor, userId: string, role: Role | null): Result<void, Forbidden | NotFound | Invalid> {
  if (!roleAllows(actor.membership.role, "manage-members")) return Result.err(new Forbidden({ message: "only owners manage members" }));
  const { workspaceId } = actor.membership;
  const current = d.memberships.get(userId, workspaceId);
  if (!current) return Result.err(new NotFound({ message: "member not found" }));
  if (current.role === "owner" && role !== "owner" && d.memberships.countOwners(workspaceId) <= 1) {
    return Result.err(new Invalid({ field: "role", message: "a workspace needs at least one owner" }));
  }
  if (role === null) d.memberships.delete(userId, workspaceId);
  else d.memberships.setRole(userId, workspaceId, role);
  return Result.ok(undefined);
}
