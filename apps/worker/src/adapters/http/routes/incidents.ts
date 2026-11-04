import { DeclareIncident, ResolveIncident } from "@tiny-uptime/contracts";
import { presentIncident } from "../presenters";
import { readBody } from "../request";
import { rejected, reply } from "../respond";
import type { Router } from "../router";
import { workspaceRoute } from "./workspace-route";

export function incidentRoutes(router: Router): void {
  router.get(
    "/api/v1/incidents",
    workspaceRoute(async (c) => {
      const limit = c.url.searchParams.get("limit");
      const monitorId = c.url.searchParams.get("monitorId");
      const query = { ...(limit ? { limit: Number(limit) } : {}), ...(monitorId ? { monitorId } : {}) };
      return reply(await c.workspace.listIncidents(c.principal, query), (list) => list.map(presentIncident));
    }),
  );
  router.post(
    "/api/v1/incidents",
    workspaceRoute(async (c) => {
      const input = await readBody(c.request, DeclareIncident);
      if (input.isErr()) return rejected(input.error);
      return reply(await c.workspace.declareIncident(c.principal, input.value), (i) => presentIncident({ ...i, monitorName: null }), 201);
    }),
  );
  router.post(
    "/api/v1/incidents/:id/resolve",
    workspaceRoute(async (c) => {
      const input = await readBody(c.request, ResolveIncident);
      if (input.isErr()) return rejected(input.error);
      return reply(await c.workspace.resolveIncident(c.principal, c.params.id!, input.value), (i) =>
        presentIncident({ ...i, monitorName: null }),
      );
    }),
  );
  router.post(
    "/api/v1/incidents/:id/acknowledge",
    workspaceRoute(async (c) => reply(await c.workspace.acknowledgeIncident(c.principal, c.params.id!), () => ({ ok: true }))),
  );
  router.get(
    "/api/v1/workspace",
    workspaceRoute(async (c) => reply(await c.workspace.info(c.principal))),
  );
}
