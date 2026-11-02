import { MonitorImportInput, OpenUptimeImportInput } from "@tiny-uptime/contracts";
import { fetchOpenUptimeMonitors, fromOpenUptime } from "../../import/openuptime";
import { presentSettings } from "../presenters";
import { readBody } from "../request";
import { json, rejected, reply } from "../respond";
import type { Router } from "../router";
import { workspaceRoute } from "./workspace-route";

const MAX_IMPORT_BYTES = 1024 * 1024;

/** Registered before the monitor routes, so `export` and `import` are not read as monitor ids. Moving monitors in and out: a JSON export, importing that export (or any list in the API's shape), and copying from OpenUptime. */
export function monitorImportRoutes(router: Router): void {
  router
    .get(
      "/api/v1/monitors/export",
      workspaceRoute(async (c) =>
        reply(await c.workspace.listMonitors(c.principal), (list) => ({
          format: "tiny-uptime.monitors",
          version: 1,
          exportedAt: new Date().toISOString(),
          monitors: list.map(presentSettings),
        })),
      ),
    )
    .post(
      "/api/v1/monitors/import",
      workspaceRoute(async (c) => {
        const input = await readBody(c.request, MonitorImportInput, MAX_IMPORT_BYTES);
        if (input.isErr()) return rejected(input.error);
        const candidates = input.value.monitors.map((raw) => ({ raw }));
        return reply(await c.workspace.importMonitors(c.principal, candidates, input.value.dryRun));
      }),
    )
    .post(
      "/api/v1/monitors/import/openuptime",
      workspaceRoute(async (c) => {
        const input = await readBody(c.request, OpenUptimeImportInput);
        if (input.isErr()) return rejected(input.error);
        const fetched = await fetchOpenUptimeMonitors(input.value.url, input.value.apiKey);
        if (fetched.isErr()) return json(502, { error: fetched.error, code: "delivery_failed" });
        if (!fetched.value.length) return json(200, { dryRun: input.value.dryRun, rows: [], created: 0, duplicates: 0, invalid: 0 });
        return reply(await c.workspace.importMonitors(c.principal, fetched.value.map(fromOpenUptime), input.value.dryRun));
      }),
    );
}
