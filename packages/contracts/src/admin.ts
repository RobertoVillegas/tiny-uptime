import * as v from "valibot";
import { ROLES } from "./auth";

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const CreateWorkspaceInput = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
  slug: v.pipe(v.string(), v.trim(), v.regex(SLUG, "must be lowercase letters, digits and dashes")),
});
export type CreateWorkspaceInput = v.InferOutput<typeof CreateWorkspaceInput>;

export const AdminInviteInput = v.object({
  workspaceId: v.pipe(v.string(), v.regex(/^[a-z2-7]{12}$/, "is not a workspace id")),
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "must be an email address")),
  role: v.optional(v.picklist(ROLES), "owner"),
});

export type WorkspaceEntry = { id: string; name: string; slug: string; createdAt: string };
