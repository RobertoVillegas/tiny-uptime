import { Result } from "better-result";
import type {
  PublicComponent,
  PublicDay,
  PublicIncident,
  PublicMaintenance,
  PublicStatusPage,
  PublicView,
  StatusPageInput,
} from "@tiny-uptime/contracts";
import type { Incident } from "../../domain/incident";
import { covers, isActive, isFinished } from "../../domain/maintenance";
import type { Monitor } from "../../domain/monitor/monitor";
import { overallStatus, type StatusComponent, type StatusPage } from "../../domain/status-page";
import { Conflict, Invalid, NotFound } from "../../errors";
import type { WorkspaceDeps } from "./deps";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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
    language: input.language,
    timeZone: input.timeZone,
    historyDays: input.historyDays,
    incidentDays: input.incidentDays,
    historyResetAt: existing?.historyResetAt ?? null,
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

/**
 * Starts a page's history over from the current hour: earlier bars show no data and earlier
 * incidents drop off the page. Nothing is deleted, so `reset: false` brings it all back.
 */
export function resetStatusPageHistory(d: WorkspaceDeps, id: string, reset: boolean): Result<StatusPageWithComponents, NotFound> {
  const page = d.statusPages.get(id);
  if (!page) return Result.err(new NotFound({ message: "status page not found" }));
  const saved = { ...page, historyResetAt: reset ? Math.floor(d.clock.now() / HOUR) * HOUR : null };
  d.statusPages.save(saved);
  return Result.ok({ ...saved, components: d.statusPages.components(id) });
}

/**
 * Everything a public page shows, without anything private: no targets, no internal notes.
 * `view.days` is the range a visitor picked, else the page's default; `view.bar` one bar of it.
 */
export function publicStatusPage(d: WorkspaceDeps, pageId: string, view: PublicView = {}): PublicStatusPage | null {
  const found = pageWithMonitors(d, pageId);
  return found && buildPublicPage(d, found.page, found.shown, view);
}

/**
 * The page a workspace slug serves when it has no status page of its own: every monitor marked
 * public, in one group. Kept so links made before status pages existed still work.
 */
export function legacyPublicPage(d: WorkspaceDeps, view: PublicView = {}): PublicStatusPage | null {
  const found = pageWithMonitors(d, null);
  return found && buildPublicPage(d, found.page, found.shown, view);
}

type Shown = { monitor: Monitor; group: string };

/** A page and the monitors it shows, in order; a null id is the legacy page of public monitors. */
function pageWithMonitors(d: WorkspaceDeps, pageId: string | null): { page: StatusPage; shown: Shown[] } | null {
  if (pageId === null) {
    const info = d.info.get();
    if (!info) return null;
    return { page: legacyPage(info.name), shown: d.monitors.listPublic().map((monitor) => ({ monitor, group: "Services" })) };
  }
  const page = d.statusPages.get(pageId);
  if (!page) return null;
  const monitors = new Map(d.monitors.list().map((m) => [m.id, m]));
  const shown = d.statusPages
    .components(pageId)
    .filter((c) => monitors.has(c.monitorId))
    .map((c) => ({ monitor: monitors.get(c.monitorId)!, group: c.group }));
  return { page, shown };
}

function legacyPage(title: string): StatusPage {
  return {
    id: "",
    slug: "",
    title,
    description: "",
    theme: "auto",
    language: "en",
    timeZone: "UTC",
    historyDays: 90,
    incidentDays: 14,
    historyResetAt: null,
    showLatency: true,
    externalUrl: null,
    hideBranding: false,
    okPct: 99.9,
    warnPct: 98,
    customDomain: null,
    createdAt: 0,
  };
}

function statusOf(m: Monitor): PublicComponent["status"] {
  return m.paused ? "paused" : m.state.status;
}

function buildPublicPage(d: WorkspaceDeps, page: StatusPage, shown: Shown[], view: PublicView): PublicStatusPage {
  const now = d.clock.now();
  const range = view.days ?? page.historyDays;
  const ids = shown.map((s) => s.monitor.id);
  const slots = range === 1 ? hourSlots(now) : daySlots(now, range, page.timeZone);
  const bars = range === 1 ? hourBars(d, ids, slots, page.historyResetAt) : dayBars(d, ids, slots, page.timeZone, page.historyResetAt);
  const windows = d.maintenance.list();
  const resetAt = page.historyResetAt ?? 0;

  const component = (m: Monitor): PublicComponent => {
    const days = bars(m.id);
    const checks = days.reduce((n, x) => n + x.checks, 0);
    const ok = days.reduce((n, x) => n + (x.uptime ?? 0) * x.checks, 0);
    return {
      id: m.id,
      name: m.name,
      status: statusOf(m),
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
  // Open incidents always show; finished ones only when they began after a reset.
  const visible = d.incidents
    .list({ limit: 200 })
    .filter((i) => names.has(i.monitorId) && i.notified && (i.resolvedAt === null || i.startedAt >= resetAt));
  const recent = visible.filter((i) => i.resolvedAt === null || i.resolvedAt >= now - page.incidentDays * DAY);
  const slot = view.bar === undefined ? undefined : slots.find((s) => s.bar === view.bar);
  const inSlot = slot ? visible.filter((i) => slot.to > resetAt && i.startedAt < slot.to && (i.resolvedAt ?? now) > slot.from) : [];
  const updates = d.incidentUpdates.forIncidents([...new Set([...recent, ...inSlot].map((i) => i.id))], true);
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

  return {
    title: page.title,
    description: page.description,
    theme: page.theme,
    language: page.language,
    timeZone: page.timeZone,
    historyDays: range,
    defaultHistoryDays: page.historyDays,
    barSize: range === 1 ? "hour" : "day",
    incidentDays: page.incidentDays,
    historyResetAt: page.historyResetAt === null ? null : iso(page.historyResetAt),
    showLatency: page.showLatency,
    externalUrl: page.externalUrl,
    hideBranding: page.hideBranding,
    okPct: page.okPct,
    warnPct: page.warnPct,
    overall: overallStatus(
      shown.map((s) => statusOf(s.monitor)),
      maintenance.some((m) => m.active),
    ),
    groups,
    activeIncidents: recent.filter((i) => i.resolvedAt === null).map(toPublic),
    pastIncidents: recent.filter((i) => i.resolvedAt !== null).map(toPublic),
    maintenance,
    selected: slot ? { bar: slot.bar, from: iso(slot.from), to: iso(slot.to), incidents: inSlot.map(toPublic) } : null,
    updatedAt: iso(now),
  };
}

/** Where one bar starts and ends; `bar` is the `PublicDay.day` it is drawn as. */
type Slot = { bar: string; from: number; to: number };

/** The last 24 hours, ending with the current hour. */
function hourSlots(now: number): Slot[] {
  const since = Math.floor(now / HOUR) * HOUR - 23 * HOUR;
  return Array.from({ length: 24 }, (_, i) => ({ bar: iso(since + i * HOUR), from: since + i * HOUR, to: since + (i + 1) * HOUR }));
}

/** The last `range` days in `zone`, each from midnight to midnight there, ending today. */
function daySlots(now: number, range: number, zone: string): Slot[] {
  const starts = [startOfDay(now, zone)];
  while (starts.length < range) starts.unshift(startOfDay(starts[0]! - HOUR, zone));
  // A local day lasts 23 to 25 hours, so 25 hours after today's midnight is always tomorrow.
  starts.push(startOfDay(starts.at(-1)! + 25 * HOUR, zone));
  return starts.slice(0, -1).map((from, i) => ({ bar: localDate(from, zone), from, to: starts[i + 1]! }));
}

function hourBars(d: WorkspaceDeps, ids: string[], slots: Slot[], resetAt: number | null): (monitorId: string) => PublicDay[] {
  const points = byMonitor(d.history.hourlyFor(ids, Math.max(slots[0]!.from, resetAt ?? 0)).map((p) => ({ ...p, at: p.hour })));
  return (monitorId) => slots.map((s) => bar(s.bar, points.get(monitorId)?.get(s.from)));
}

/**
 * UTC pages without a reset in range read the daily rollup; others sum hours into local days, so a
 * day runs midnight to midnight where the page lives and hours before a reset count for nothing.
 */
function dayBars(d: WorkspaceDeps, ids: string[], slots: Slot[], zone: string, resetAt: number | null): (monitorId: string) => PublicDay[] {
  const since = slots[0]!.from;
  if (zone === "UTC" && (resetAt === null || resetAt <= since)) {
    const daily = byMonitor(d.history.daily(ids, since).map((p) => ({ ...p, at: p.day })));
    return (monitorId) => slots.map((s) => bar(s.bar, daily.get(monitorId)?.get(s.from)));
  }
  const sums = new Map<string, { checks: number; ok: number }[]>();
  for (const p of d.history.hourlyFor(ids, Math.max(since, resetAt ?? 0))) {
    let i = slots.length - 1;
    while (i > 0 && p.hour < slots[i]!.from) i--;
    let mine = sums.get(p.monitorId);
    if (!mine) sums.set(p.monitorId, (mine = []));
    const sum = (mine[i] ??= { checks: 0, ok: 0 });
    sum.checks += p.checks;
    sum.ok += p.ok;
  }
  return (monitorId) => slots.map((s, i) => bar(s.bar, sums.get(monitorId)?.[i]));
}

/** The instant the local day containing `ms` began in `zone`. */
function startOfDay(ms: number, zone: string): number {
  const [y, m, day] = localDate(ms, zone).split("-").map(Number) as [number, number, number];
  const midnight = Date.UTC(y, m - 1, day);
  // Local midnight is UTC midnight minus the zone's offset; take the offset near that instant twice
  // so a DST change during the night lands on the right side.
  let at = midnight - offset(midnight, zone);
  at = midnight - offset(at, zone);
  return at;
}

/** The local calendar date of `ms` in `zone`, as YYYY-MM-DD. */
function localDate(ms: number, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

/** How far `zone`'s wall clock is ahead of UTC at `ms`. */
function offset(ms: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(ms)
      .map((p) => [p.type, Number(p.value)]),
  );
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return wall - Math.floor(ms / 1000) * 1000;
}

function byMonitor<T extends { monitorId: string; at: number }>(points: T[]): Map<string, Map<number, T>> {
  const out = new Map<string, Map<number, T>>();
  for (const p of points) {
    let mine = out.get(p.monitorId);
    if (!mine) out.set(p.monitorId, (mine = new Map()));
    mine.set(p.at, p);
  }
  return out;
}

function bar(day: string, point: { checks: number; ok: number } | undefined): PublicDay {
  return { day, checks: point?.checks ?? 0, uptime: point?.checks ? point.ok / point.checks : null };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
