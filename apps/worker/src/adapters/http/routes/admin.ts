import { AdminInviteInput, CreateWorkspaceInput } from "@tiny-uptime/contracts";
import { cryptoIds } from "../../system";
import { workspaceStub } from "../principal";
import { readBody } from "../request";
import { failWith, json, rejected } from "../respond";
import type { Ctx, Handler, Router } from "../router";
import { authStore, isOperator } from "../session";

/** The instance operator, holding ADMIN_TOKEN: creates workspaces and invites their first owner. */
export function adminRoutes(router: Router): void {
  router
    .get(
      "/api/admin/workspaces",
      operator(async (c) => json(200, await directory(c).list())),
    )
    .post(
      "/api/admin/workspaces",
      operator(async (c) => {
        const input = await readBody(c.request, CreateWorkspaceInput);
        if (input.isErr()) return rejected(input.error);
        const id = cryptoIds.id();
        const entry = await directory(c).register(id, input.value.name, input.value.slug);
        if ("error" in entry) return failWith(409, "conflict", entry.error);
        const workspace = workspaceStub(c, id);
        await workspace.init(id, input.value.name);
        return json(201, { ...entry, apiKey: await workspace.issueApiKey("initial") });
      }),
    )
    .post(
      "/api/admin/invites",
      operator(async (c) => {
        const input = await readBody(c.request, AdminInviteInput);
        if (input.isErr()) return rejected(input.error);
        const entry = (await directory(c).list()).find((w) => w.id === input.value.workspaceId);
        if (!entry) return failWith(404, "not_found", "workspace not found");
        const { email, role } = input.value;
        const token = await authStore(c.env).createInvite({ email, workspaceId: entry.id, workspaceName: entry.name, role });
        return json(201, { inviteUrl: `${c.url.origin}/app/invite?token=${token}`, email, role });
      }),
    );
}

function operator(handler: Handler): Handler {
  return async (c) => ((await isOperator(c.request, c.env)) ? handler(c) : failWith(401, "unauthorized", "unauthorized"));
}

function directory(c: Ctx) {
  return c.env.DIRECTORY.get(c.env.DIRECTORY.idFromName("directory"));
}
