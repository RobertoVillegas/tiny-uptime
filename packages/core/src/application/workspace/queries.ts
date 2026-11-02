import { Result } from "better-result";
import { MAX_INCIDENTS_PAGE, MAX_STATS_HOURS, type MonitorStats, type PublicStatus } from "@tiny-uptime/contracts";
import type { NotFound } from "../../errors";
import type { IncidentListing } from "../../ports/workspace";
import type { WorkspaceDeps } from "./deps";
import { getMonitor } from "./monitors";

const HOUR = 3_600_000;

export function monitorStats(d: WorkspaceDeps, id: string, requestedHours: number): Result<MonitorStats, NotFound> {
  return getMonitor(d, id).map(() => {
    const hours = clamp(requestedHours, 1, MAX_STATS_HOURS, 24);
    const points = d.history.hourly(id, hourStart(d.clock.now()) - (hours - 1) * HOUR);
    const sum = (pick: (p: (typeof points)[number]) => number) => points.reduce((n, p) => n + pick(p), 0);
    const checks = sum((p) => p.checks);
    const latencyCount = sum((p) => p.latencyCount);
    return {
      hours,
      uptime: checks ? sum((p) => p.ok) / checks : null,
      avgLatencyMs: latencyCount ? Math.round(sum((p) => p.latencySum) / latencyCount) : null,
      series: points.map((p) => ({
        hour: new Date(p.hour).toISOString(),
        checks: p.checks,
        ok: p.ok,
        avgLatencyMs: p.latencyCount ? Math.round(p.latencySum / p.latencyCount) : null,
      })),
    };
  });
}

export function listIncidents(d: WorkspaceDeps, query: { limit?: number; monitorId?: string }): IncidentListing[] {
  return d.incidents.list({ limit: clamp(query.limit, 1, MAX_INCIDENTS_PAGE, 50), ...(query.monitorId ? { monitorId: query.monitorId } : {}) });
}

/** What the public status page shows: monitors marked public and their last 24 hours. */
export function publicStatus(d: WorkspaceDeps): PublicStatus | null {
  const info = d.info.get();
  if (!info) return null;
  const points = d.history.publicHourly(hourStart(d.clock.now()) - 23 * HOUR);
  const monitors = d.monitors.listPublic().map((m) => {
    const mine = points.filter((p) => p.monitorId === m.id);
    const checks = mine.reduce((n, p) => n + p.checks, 0);
    const ok = mine.reduce((n, p) => n + p.ok, 0);
    return {
      id: m.id,
      name: m.name,
      status: m.state.status,
      lastMs: m.state.lastLatencyMs,
      uptime24h: checks ? ok / checks : null,
      hours: mine.map(({ hour, checks, ok }) => ({ hour, checks, ok })),
    };
  });
  return { name: info.name, monitors };
}

function hourStart(at: number): number {
  return Math.floor(at / HOUR) * HOUR;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.min(Math.max(Math.trunc(value), min), max);
}
