import { MonitorBulk, MonitorInput, MonitorPatch } from "@tiny-uptime/contracts";
import { presentMonitor } from "../presenters";
import { readBody } from "../request";
import { rejected, reply } from "../respond";
import type { Router } from "../router";
import { workspaceRoute } from "./workspace-route";

export function monitorRoutes(router: Router): void {
  router
    .get(
      "/api/v1/monitors/activity",
      workspaceRoute(async (c) => reply(await c.workspace.monitorsActivity(c.principal))),
    )
    .get(
      "/api/v1/monitors",
      workspaceRoute(async (c) =>
        reply(await c.workspace.listMonitors(c.principal, tagFilter(c.url)), (list) => list.map((m) => presentMonitor(m, c.url.origin))),
      ),
    )
    .post(
      "/api/v1/monitors",
      workspaceRoute(async (c) => {
        const input = await readBody(c.request, MonitorInput);
        if (input.isErr()) return rejected(input.error);
        return reply(await c.workspace.createMonitor(c.principal, input.value), (m) => presentMonitor(m, c.url.origin), 201);
      }),
    )
    .get(
      "/api/v1/monitors/:id",
      workspaceRoute(async (c) => reply(await c.workspace.getMonitor(c.principal, c.params.id!), (m) => presentMonitor(m, c.url.origin))),
    )
    .patch(
      "/api/v1/monitors/:id",
      workspaceRoute(async (c) => {
        const patch = await readBody(c.request, MonitorPatch);
        if (patch.isErr()) return rejected(patch.error);
        return reply(await c.workspace.updateMonitor(c.principal, c.params.id!, patch.value), (m) => presentMonitor(m, c.url.origin));
      }),
    )
    .delete(
      "/api/v1/monitors/:id",
      workspaceRoute(async (c) => reply(await c.workspace.deleteMonitor(c.principal, c.params.id!), undefined, 204)),
    )
    .post(
      "/api/v1/monitors/bulk",
      workspaceRoute(async (c) => {
        const bulk = await readBody(c.request, MonitorBulk);
        if (bulk.isErr()) return rejected(bulk.error);
        return reply(await c.workspace.bulkMonitors(c.principal, bulk.value));
      }),
    )
    .post(
      "/api/v1/monitors/:id/check",
      workspaceRoute(async (c) =>
        reply(await c.workspace.checkNow(c.principal, c.params.id!), ({ outcome, monitor }) => ({
          ...outcome,
          monitor: presentMonitor(monitor, c.url.origin),
        })),
      ),
    )
    .get(
      "/api/v1/monitors/:id/stats",
      workspaceRoute(async (c) =>
        reply(await c.workspace.monitorStats(c.principal, c.params.id!, Number(c.url.searchParams.get("hours") ?? 24))),
      ),
    );
}

function tagFilter(url: URL): { tag?: string } {
  const tag = url.searchParams.get("tag");
  return tag ? { tag } : {};
}
