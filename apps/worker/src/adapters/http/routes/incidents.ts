import { presentIncident } from "../presenters";
import { reply } from "../respond";
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
    "/api/v1/incidents/:id/acknowledge",
    workspaceRoute(async (c) => reply(await c.workspace.acknowledgeIncident(c.principal, c.params.id!), () => ({ ok: true }))),
  );
  router.get(
    "/api/v1/workspace",
    workspaceRoute(async (c) => reply(await c.workspace.info(c.principal))),
  );
}
