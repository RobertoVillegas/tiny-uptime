import { Result } from "better-result";
import { MonitorInput, validate, type MonitorPatch } from "@tiny-uptime/contracts";
import { toInput, toSettings, type Monitor } from "../../domain/monitor/monitor";
import { firstCheckAt } from "../../domain/monitor/schedule";
import { applySettings } from "../../domain/monitor/settings";
import { Invalid, NotFound } from "../../errors";
import type { WorkspaceDeps } from "./deps";

export function listMonitors(d: WorkspaceDeps): Monitor[] {
  return d.monitors.list();
}

export function getMonitor(d: WorkspaceDeps, id: string): Result<Monitor, NotFound> {
  const monitor = d.monitors.get(id);
  return monitor ? Result.ok(monitor) : Result.err(new NotFound({ message: "monitor not found" }));
}

export async function createMonitor(d: WorkspaceDeps, input: MonitorInput): Promise<Monitor> {
  const now = d.clock.now();
  const settings = toSettings(input);
  const workspaceId = d.info.get()!.id;
  const monitor: Monitor = {
    ...settings,
    id: d.ids.id(),
    heartbeatToken: settings.type === "heartbeat" ? `${workspaceId}_${d.ids.secret(16)}` : null,
    state: {
      status: settings.paused ? "paused" : "pending",
      failures: 0,
      openIncidentId: null,
      nextCheckAt: firstCheckAt(settings, now),
      lastCheckedAt: null,
      lastLatencyMs: null,
      lastDetail: null,
      statusChangedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
  d.monitors.insert(monitor);
  await d.scheduler.sync();
  return monitor;
}

/** Applies the changed fields on top of the current settings and validates the result as a whole. */
export async function updateMonitor(d: WorkspaceDeps, id: string, patch: MonitorPatch): Promise<Result<Monitor, NotFound | Invalid>> {
  return Result.gen(async function* () {
    const current = yield* getMonitor(d, id);
    if (patch.type !== undefined && patch.type !== current.type) return Result.err(new Invalid({ field: "type", message: "type: cannot be changed" }));
    const parsed = validate(MonitorInput, { ...toInput(current), ...patch, type: current.type });
    if (!parsed.ok) return Result.err(new Invalid({ field: parsed.field, message: parsed.message }));

    const now = d.clock.now();
    const settings = toSettings(parsed.value);
    const change = applySettings(current, settings, now);
    if (change.closedIncidentId) d.incidents.resolve(change.closedIncidentId, now);
    const updated: Monitor = { ...current, ...settings, state: change.state, updatedAt: now };
    d.monitors.save(updated);
    await d.scheduler.sync();
    return Result.ok(updated);
  });
}

export async function deleteMonitor(d: WorkspaceDeps, id: string): Promise<Result<void, NotFound>> {
  return Result.gen(async function* () {
    yield* getMonitor(d, id);
    d.monitors.delete(id);
    d.history.deleteForMonitor(id);
    d.incidents.deleteForMonitor(id);
    await d.scheduler.sync();
    return Result.ok(undefined);
  });
}
