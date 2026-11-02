import { AlertPolicyInput, MaintenanceInput } from "@tiny-uptime/contracts";
import { presentMaintenance } from "../presenters";
import { readBody } from "../request";
import { rejected, reply } from "../respond";
import type { Router } from "../router";
import { workspaceRoute } from "./workspace-route";

/** Maintenance windows, and the workspace's policy for reminders and escalation. */
export function maintenanceRoutes(router: Router): void {
  router
    .get(
      "/api/v1/maintenance",
      workspaceRoute(async (c) => reply(await c.workspace.listMaintenance(c.principal), (list) => list.map((w) => presentMaintenance(w)))),
    )
    .post(
      "/api/v1/maintenance",
      workspaceRoute(async (c) => {
        const input = await readBody(c.request, MaintenanceInput);
        if (input.isErr()) return rejected(input.error);
        return reply(await c.workspace.createMaintenance(c.principal, input.value), (w) => presentMaintenance(w), 201);
      }),
    )
    .patch(
      "/api/v1/maintenance/:id",
      workspaceRoute(async (c) => {
        const input = await readBody(c.request, MaintenanceInput);
        if (input.isErr()) return rejected(input.error);
        return reply(await c.workspace.updateMaintenance(c.principal, c.params.id!, input.value), (w) => presentMaintenance(w));
      }),
    )
    .delete(
      "/api/v1/maintenance/:id",
      workspaceRoute(async (c) => reply(await c.workspace.deleteMaintenance(c.principal, c.params.id!), undefined, 204)),
    )
    .get(
      "/api/v1/alert-policy",
      workspaceRoute(async (c) => reply(await c.workspace.alertPolicy(c.principal))),
    )
    .patch(
      "/api/v1/alert-policy",
      workspaceRoute(async (c) => {
        const input = await readBody(c.request, AlertPolicyInput);
        if (input.isErr()) return rejected(input.error);
        return reply(await c.workspace.setAlertPolicy(c.principal, input.value));
      }),
    );
}
