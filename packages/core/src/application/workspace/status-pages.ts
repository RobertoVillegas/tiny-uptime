import { Result } from "better-result";
import type { PublicComponent, PublicIncident, PublicMaintenance, PublicStatusPage, StatusPageInput } from "@tiny-uptime/contracts";
import type { Incident } from "../../domain/incident";
import { covers, isActive, isFinished } from "../../domain/maintenance";
import type { Monitor } from "../../domain/monitor/monitor";
import { overallStatus, PUBLIC_DAYS, PUBLIC_INCIDENT_DAYS, type StatusComponent, type StatusPage } from "../../domain/status-page";
import { Conflict, Invalid, NotFound } from "../../errors";
import type { WorkspaceDeps } from "./deps";

const DAY = 86_400_000;

export type StatusPageWithComponents = StatusPage & { components: StatusComponent[] };

export function listStatusPages(d: WorkspaceDeps): StatusPageWithComponents[] {
  return d.statusPages.list().map((page) => ({ ...page, components: d.statusPages.components(page.id) }));
}

export function getStatusPage(d: WorkspaceDeps, id: string): Result<StatusPageWithComponents, NotFound> {
  const page = d.statusPages.get(id);
  return page
    ? Result.ok({ ...page, components: d.statusPages.components(id) })
    : Result.err(new NotFound({ message: "status page not found" }));
}

/**
 * Creates or updates a page under the given id. Slugs and custom domains are unique across the
 * instance, so the caller claims them in the directory, under this id, before saving.
 */
export function saveStatusPage(
  d: WorkspaceDeps,
  id: string,
  mode: "create" | "update",
  input: StatusPageInput,
): Result<StatusPageWithComponents, NotFound | Invalid | Conflict> {
  const existing = d.statusPages.get(id);
  if (mode === "update" && !existing) return Result.err(new NotFound({ message: "status page not found" }));
  if (mode === "create" && existing) return Result.err(new Conflict({ message: "a status page with this id exists" }));
  const sameSlug = d.statusPages.bySlug(input.slug);
  if (sameSlug && sameSlug.id !== id) return Result.err(new Conflict({ message: "another status page uses this slug" }));
  const unknown = input.components.find((c) => !d.monitors.get(c.monitorId));
  if (unknown)
    return Result.err(new Invalid({ field: "components", message: `components: no monitor ${unknown.monitorId} in this workspace` }));
  const duplicate = input.components.find((c, i) => input.components.findIndex((o) => o.monitorId === c.monitorId) !== i);
  if (duplicate) return Result.err(new Invalid({ field: "components", message: "components: a monitor can appear once per page" }));

  const page: StatusPage = {
    id,
    slug: input.slug,
    title: input.title,
    description: input.description,
    theme: input.theme,
    showLatency: input.showLatency,
    externalUrl: input.externalUrl,
    hideBranding: input.hideBranding,
    okPct: input.okPct,
    warnPct: input.warnPct,
    customDomain: input.customDomain,
    createdAt: existing?.createdAt ?? d.clock.now(),
  };
  if (existing) d.statusPages.save(page);
  else d.statusPages.insert(page);
  const components = input.components.map((c, position) => ({ pageId: page.id, monitorId: c.monitorId, group: c.group, position }));
  d.statusPages.setComponents(page.id, components);
  return Result.ok({ ...page, components });
}

export function deleteStatusPage(d: WorkspaceDeps, id: string): Result<StatusPage, NotFound> {
  const page = d.statusPages.get(id);
  if (!page) return Result.err(new NotFound({ message: "status page not found" }));
  d.statusPages.delete(id);
  return Result.ok(page);
}

/** Everything a public page shows, without anything private: no targets, no internal notes. */
export function publicStatusPage(d: WorkspaceDeps, pageId: string): PublicStatusPage | null {
  const page = d.statusPages.get(pageId);
  if (!page) return null;
  const monitors = new Map(d.monitors.list().map((m) => [m.id, m]));
  const components = d.statusPages.components(pageId).filter((c) => monitors.has(c.monitorId));
  return buildPublicPage(
    d,
    page,
    components.map((c) => ({ monitor: monitors.get(c.monitorId)!, group: c.group })),
  );
}

/**
 * The page a workspace slug serves when it has no status page of its own: every monitor marked
 * public, in one group. Kept so links made before status pages existed still work.
 */
export function legacyPublicPage(d: WorkspaceDeps): PublicStatusPage | null {
  const info = d.info.get();
  if (!info) return null;
  const page: StatusPage = {
    id: "",
    slug: "",
    title: info.name,
    description: "",
    theme: "auto",
    showLatency: true,
    externalUrl: null,
    hideBranding: false,
    okPct: 99.9,
    warnPct: 98,
    customDomain: null,
    createdAt: 0,
  };
  return buildPublicPage(
    d,
    page,
    d.monitors.listPublic().map((monitor) => ({ monitor, group: "Services" })),
  );
}

function buildPublicPage(d: WorkspaceDeps, page: StatusPage, shown: { monitor: Monitor; group: string }[]): PublicStatusPage {
  const now = d.clock.now();
  const today = Math.floor(now / DAY) * DAY;
  const since = today - (PUBLIC_DAYS - 1) * DAY;
  const ids = shown.map((s) => s.monitor.id);
  const daily = d.history.daily(ids, since);
  const windows = d.maintenance.list();

  const component = (m: Monitor): PublicComponent => {
    const mine = new Map(daily.filter((p) => p.monitorId === m.id).map((p) => [p.day, p]));
    const days = Array.from({ length: PUBLIC_DAYS }, (_, i) => {
      const day = since + i * DAY;
      const point = mine.get(day);
      return {
        day: new Date(day).toISOString().slice(0, 10),
        checks: point?.checks ?? 0,
        uptime: point?.checks ? point.ok / point.checks : null,
      };
    });
    const checks = days.reduce((n, x) => n + x.checks, 0);
    const ok = [...mine.values()].reduce((n, x) => n + x.ok, 0);
    return {
      id: m.id,
      name: m.name,
      status: m.paused ? "paused" : m.state.status,
      uptime: checks ? ok / checks : null,
      latencyMs: page.showLatency ? m.state.lastLatencyMs : null,
      days,
    };
  };

  const groups: PublicStatusPage["groups"] = [];
  for (const { monitor, group } of shown) {
    let entry = groups.find((g) => g.name === group);
    if (!entry) groups.push((entry = { name: group, components: [] }));
    entry.components.push(component(monitor));
  }

  const names = new Map(shown.map((s) => [s.monitor.id, s.monitor.name]));
  const incidents = d.incidents
    .list({ limit: 200 })
    .filter((i) => names.has(i.monitorId) && (i.resolvedAt === null || i.resolvedAt >= now - PUBLIC_INCIDENT_DAYS * DAY));
  const updates = d.incidentUpdates.forIncidents(
    incidents.map((i) => i.id),
    true,
  );
  const toPublic = (i: Incident): PublicIncident => ({
    id: i.id,
    title: i.cause,
    componentName: names.get(i.monitorId)!,
    kind: i.kind,
    startedAt: iso(i.startedAt),
    resolvedAt: i.resolvedAt === null ? null : iso(i.resolvedAt),
    updates: updates
      .filter((u) => u.incidentId === i.id)
      .map((u) => ({ status: u.status, body: u.body, createdAt: iso(u.createdAt) }))
      .toReversed(),
  });

  const maintenance: PublicMaintenance[] = windows
    .filter((w) => !isFinished(w, now) && ids.some((id) => covers(w, id)))
    .map((w) => ({
      name: w.name,
      startsAt: iso(w.startsAt),
      endsAt: iso(w.endsAt),
      active: isActive(w, now),
      componentNames: w.monitorIds.length ? w.monitorIds.filter((id) => names.has(id)).map((id) => names.get(id)!) : [...names.values()],
    }));

  const statuses = shown.map((s) => (s.monitor.paused ? "paused" : s.monitor.state.status));
  return {
    title: page.title,
    description: page.description,
    theme: page.theme,
    showLatency: page.showLatency,
    externalUrl: page.externalUrl,
    hideBranding: page.hideBranding,
    okPct: page.okPct,
    warnPct: page.warnPct,
    overall: overallStatus(
      statuses,
      maintenance.some((m) => m.active),
    ),
    groups,
    activeIncidents: incidents.filter((i) => i.resolvedAt === null && i.notified).map(toPublic),
    pastIncidents: incidents.filter((i) => i.resolvedAt !== null && i.notified).map(toPublic),
    maintenance,
    updatedAt: iso(now),
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
