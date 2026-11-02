import type { Principal } from "@tiny-uptime/core";
import { resolveCall, workspaceStub } from "../principal";
import type { Ctx, Handler } from "../router";

export type WorkspaceCtx = Ctx & { workspace: ReturnType<typeof workspaceStub>; principal: Principal };

/** Wraps a REST handler: resolves who is calling and which workspace, then hands over its stub. */
export function workspaceRoute(handler: (ctx: WorkspaceCtx) => Promise<Response>): Handler {
  return async (ctx) => {
    const call = await resolveCall(ctx);
    if (call.isErr()) return call.error;
    return handler({ ...ctx, workspace: workspaceStub(ctx, call.value.workspaceId), principal: call.value.principal });
  };
}
