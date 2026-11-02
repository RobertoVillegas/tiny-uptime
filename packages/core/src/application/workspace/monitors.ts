import { Result } from "better-result";
import { MonitorInput, validate, type MonitorPatch } from "@tiny-uptime/contracts";
import { toInput, toSettings, type Monitor, type MonitorSettings } from "../../domain/monitor/monitor";
import { firstCheckAt } from "../../domain/monitor/schedule";
import { applySettings } from "../../domain/monitor/settings";
import { Invalid, NotFound } from "../../errors";
import type { WorkspaceDeps } from "./deps";

export function listMonitors(d: WorkspaceDeps, filter: { tag?: string } = {}): Monitor[] {
  const all = d.monitors.list();
  return filter.tag ? all.filter((m) => m.options.tags.includes(filter.tag!)) : all;
}

/** Cross-record rules the schema cannot check: the dependency and channels must exist, and dependencies cannot loop. */
function checkReferences(d: WorkspaceDeps, id: string | null, settings: MonitorSettings): Result<void, Invalid> {
  const { dependsOn, channelIds } = settings.options;
  if (dependsOn) {
    if (dependsOn === id) return Result.err(new Invalid({ field: "dependsOn", message: "dependsOn: a monitor cannot depend on itself" }));
    let parent = d.monitors.get(dependsOn);
    if (!parent) return Result.err(new Invalid({ field: "dependsOn", message: "dependsOn: no such monitor in this workspace" }));
    for (let depth = 0; parent && depth < 20; depth++) {
      if (parent.id === id)
        return Result.err(new Invalid({ field: "dependsOn", message: "dependsOn: this would make monitors depend on each other" }));
      parent = parent.options.dependsOn ? d.monitors.get(parent.options.dependsOn) : null;
    }
  }
  const unknown = channelIds.find((channelId) => !d.channels.get(channelId));
  if (unknown) return Result.err(new Invalid({ field: "channelIds", message: `channelIds: no channel ${unknown} in this workspace` }));
  return Result.ok(undefined);
}

export function getMonitor(d: WorkspaceDeps, id: string): Result<Monitor, NotFound> {
  const monitor = d.monitors.get(id);
  return monitor ? Result.ok(monitor) : Result.err(new NotFound({ message: "monitor not found" }));
}

export async function createMonitor(d: WorkspaceDeps, input: MonitorInput): Promise<Result<Monitor, Invalid>> {
  const now = d.clock.now();
  const settings = toSettings(input);
  const references = checkReferences(d, null, settings);
  if (references.isErr()) return references;
  const workspaceId = d.info.get()!.id;
  const monitor: Monitor = {
    ...settings,
    id: d.ids.id(),
    heartbeatToken: settings.type === "heartbeat" ? `${workspaceId}_${d.ids.secret(16)}` : null,
    state: {
      status: settings.paused ? "paused" : "pending",
      failures: 0,
      successes: 0,
      slowStreak: 0,
      openIncidentId: null,
      openSlowIncidentId: null,
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
  return Result.ok(monitor);
}

/** Applies the changed fields on top of the current settings and validates the result as a whole. */
export async function updateMonitor(d: WorkspaceDeps, id: string, patch: MonitorPatch): Promise<Result<Monitor, NotFound | Invalid>> {
  return Result.gen(async function* () {
    const current = yield* getMonitor(d, id);
    if (patch.type !== undefined && patch.type !== current.type)
      return Result.err(new Invalid({ field: "type", message: "type: cannot be changed" }));
    const parsed = validate(MonitorInput, { ...toInput(current), ...patch, type: current.type });
    if (!parsed.ok) return Result.err(new Invalid({ field: parsed.field, message: parsed.message }));

    const now = d.clock.now();
    const settings = toSettings(parsed.value);
    yield* checkReferences(d, id, settings);
    const change = applySettings(current, settings, now);
    for (const incidentId of change.closedIncidentIds) d.incidents.resolve(incidentId, now);
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
