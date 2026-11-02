import { ApiKeyInput, type CreatedApiKey } from "@tiny-uptime/contracts";
import { presentApiKey } from "../presenters";
import { readBody } from "../request";
import { rejected, reply } from "../respond";
import type { Router } from "../router";
import { workspaceRoute } from "./workspace-route";

export function apiKeyRoutes(router: Router): void {
  router
    .get("/api/v1/api-keys", workspaceRoute(async (c) => reply(await c.workspace.listApiKeys(c.principal), (list) => list.map(presentApiKey))))
    .post(
      "/api/v1/api-keys",
      workspaceRoute(async (c) => {
        const input = await readBody(c.request, ApiKeyInput);
        if (input.isErr()) return rejected(input.error);
        const created = await c.workspace.createApiKey(c.principal, input.value.name);
        return reply(created, ({ apiKey, key }): CreatedApiKey => ({ ...presentApiKey(apiKey), key }), 201);
      }),
    )
    .delete("/api/v1/api-keys/:id", workspaceRoute(async (c) => reply(await c.workspace.deleteApiKey(c.principal, c.params.id!), undefined, 204)));
}
