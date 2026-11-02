import { Result } from "better-result";
import type { Principal } from "@tiny-uptime/core";
import { cryptoIds } from "../system";
import type { Ctx } from "./router";
import { failWith } from "./respond";
import { bearer } from "./request";
import { sameOrigin, signedIn } from "./session";

const API_KEY = /^tu_([a-z2-7]{12})_[0-9a-f]{48}$/;
const WORKSPACE_ID = /^[a-z2-7]{12}$/;

export type WorkspaceCall = { workspaceId: string; principal: Principal };

/**
 * Who is calling the REST API, and for which workspace: an API key names its workspace (the
 * workspace verifies the key), a signed-in member names it in `x-workspace-id` (checked here).
 */
export async function resolveCall(ctx: Ctx): Promise<Result<WorkspaceCall, Response>> {
  const key = bearer(ctx.request);
  if (key) {
    const match = API_KEY.exec(key);
    if (!match) return Result.err(failWith(401, "unauthorized", "malformed API key"));
    return Result.ok({ workspaceId: match[1]!, principal: { kind: "key", keyHash: await cryptoIds.hash(key) } });
  }
  const session = await signedIn(ctx.request, ctx.env);
  if (!session) return Result.err(failWith(401, "unauthorized", "sign in or send an API key"));
  if (!sameOrigin(ctx.request, ctx.url)) return Result.err(failWith(403, "forbidden", "cross-origin request refused"));
  const requested = ctx.request.headers.get("x-workspace-id") ?? "";
  const membership = session.info.memberships.find((m) => m.workspaceId === requested);
  if (!membership) return Result.err(failWith(404, "not_found", "workspace not found"));
  return Result.ok({ workspaceId: membership.workspaceId, principal: { kind: "member", userId: session.info.userId, role: membership.role } });
}

export function workspaceStub(ctx: Ctx, id: string) {
  if (!WORKSPACE_ID.test(id)) throw new Error("invalid workspace id");
  return ctx.env.WORKSPACE.get(ctx.env.WORKSPACE.idFromName(id));
}
