import {
  IncidentUpdateInput,
  StatusPageInput,
  type IncidentUpdate as IncidentUpdateDto,
  type StatusPage as StatusPageDto,
} from "@tiny-uptime/contracts";
import type { IncidentUpdate, workspace } from "@tiny-uptime/core";
import { cryptoIds } from "../../system";
import { readBody } from "../request";
import { fail, rejected, reply } from "../respond";
import type { Router } from "../router";
import { workspaceRoute, type WorkspaceCtx } from "./workspace-route";

/** Status pages, whose slugs and domains are claimed in the directory before the workspace saves them, and incident updates. */
export function statusPageRoutes(router: Router): void {
  router
    .get(
      "/api/v1/status-pages",
      workspaceRoute(async (c) =>
        reply(await c.workspace.listStatusPages(c.principal), (list) => list.map((p) => present(p, c.url.origin))),
      ),
    )
    .post(
      "/api/v1/status-pages",
      workspaceRoute((c) => save(c, cryptoIds.id(), "create")),
    )
    .get(
      "/api/v1/status-pages/:id",
      workspaceRoute(async (c) => reply(await c.workspace.getStatusPage(c.principal, c.params.id!), (p) => present(p, c.url.origin))),
    )
    .patch(
      "/api/v1/status-pages/:id",
      workspaceRoute((c) => save(c, c.params.id!, "update")),
    )
    .post(
      "/api/v1/status-pages/:id/history-reset",
      workspaceRoute(async (c) =>
        reply(await c.workspace.resetStatusPageHistory(c.principal, c.params.id!, true), (p) => present(p, c.url.origin)),
      ),
    )
    .delete(
      "/api/v1/status-pages/:id/history-reset",
      workspaceRoute(async (c) =>
        reply(await c.workspace.resetStatusPageHistory(c.principal, c.params.id!, false), (p) => present(p, c.url.origin)),
      ),
    )
    .delete(
      "/api/v1/status-pages/:id",
      workspaceRoute(async (c) => {
        const deleted = await c.workspace.deleteStatusPage(c.principal, c.params.id!);
        if (deleted.status === "ok") await directory(c).releasePage(c.params.id!);
        return reply(deleted, undefined, 204);
      }),
    )
    .get(
      "/api/v1/incidents/:id/updates",
      workspaceRoute(async (c) =>
        reply(await c.workspace.listIncidentUpdates(c.principal, c.params.id!), (list) => list.map(presentUpdate)),
      ),
    )
    .post(
      "/api/v1/incidents/:id/updates",
      workspaceRoute(async (c) => {
        const input = await readBody(c.request, IncidentUpdateInput);
        if (input.isErr()) return rejected(input.error);
        return reply(await c.workspace.postIncidentUpdate(c.principal, c.params.id!, input.value), presentUpdate, 201);
      }),
    );
}

async function save(c: WorkspaceCtx, id: string, mode: "create" | "update"): Promise<Response> {
  const input = await readBody(c.request, StatusPageInput);
  if (input.isErr()) return rejected(input.error);
  const allowed = await c.workspace.canWrite(c.principal);
  if (allowed.status === "error") return fail(allowed.error);
  if (mode === "update") {
    const existing = await c.workspace.getStatusPage(c.principal, id);
    if (existing.status === "error") return fail(existing.error);
  }
  const info = await c.workspace.info(c.principal);
  if (info.status === "error") return fail(info.error);
  const claim = await directory(c).claimPage(info.value.id, id, input.value.slug, input.value.customDomain);
  if ("error" in claim) return fail({ _tag: "Conflict", message: `${claim.field}: ${claim.error}`, field: claim.field });
  const saved = await c.workspace.saveStatusPage(c.principal, id, mode, input.value);
  if (saved.status === "error" && mode === "create") await directory(c).releasePage(id);
  return reply(saved, (p) => present(p, c.url.origin), mode === "create" ? 201 : 200);
}

function present(p: workspace.StatusPageWithComponents, origin: string): StatusPageDto {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    theme: p.theme,
    language: p.language,
    timeZone: p.timeZone,
    historyDays: p.historyDays,
    incidentDays: p.incidentDays,
    historyResetAt: p.historyResetAt === null ? null : new Date(p.historyResetAt).toISOString(),
    showLatency: p.showLatency,
    externalUrl: p.externalUrl,
    hideBranding: p.hideBranding,
    okPct: p.okPct,
    warnPct: p.warnPct,
    customDomain: p.customDomain,
    components: p.components.map((c) => ({ monitorId: c.monitorId, group: c.group })),
    url: p.customDomain ? `https://${p.customDomain}/` : `${origin}/s/${p.slug}`,
    createdAt: new Date(p.createdAt).toISOString(),
  };
}

function presentUpdate(u: IncidentUpdate): IncidentUpdateDto {
  return {
    id: u.id,
    incidentId: u.incidentId,
    status: u.status,
    body: u.body,
    visibility: u.visibility,
    author: u.author,
    createdAt: new Date(u.createdAt).toISOString(),
  };
}

function directory(c: WorkspaceCtx) {
  return c.env.DIRECTORY.get(c.env.DIRECTORY.idFromName("directory"));
}
