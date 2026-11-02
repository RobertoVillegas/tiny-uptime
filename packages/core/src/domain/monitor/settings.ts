import type { Monitor, MonitorSettings, MonitorState } from "./monitor";
import { firstCheckAt, heartbeatDeadline } from "./schedule";

export type SettingsChange = {
  state: MonitorState;
  /** An open incident closed without an alert, because the monitor was paused. */
  closedIncidentId: string | null;
};

/** How new settings move a monitor: pausing stops it, resuming starts over, a new target checks again soon. */
export function applySettings(monitor: Monitor, next: MonitorSettings, now: number): SettingsChange {
  const current = monitor.state;
  if (next.paused && !monitor.paused) {
    return {
      state: { ...current, status: "paused", statusChangedAt: now, nextCheckAt: null, failures: 0, openIncidentId: null },
      closedIncidentId: current.openIncidentId,
    };
  }
  if (!next.paused && monitor.paused) {
    return { state: { ...current, status: "pending", statusChangedAt: now, nextCheckAt: firstCheckAt(next, now) }, closedIncidentId: null };
  }
  if (!next.paused && checkChanged(monitor, next)) {
    const nextCheckAt = next.type === "heartbeat" ? heartbeatDeadline(next, current.lastCheckedAt ?? now) : now;
    return { state: { ...current, nextCheckAt }, closedIncidentId: null };
  }
  return { state: current, closedIncidentId: null };
}

function checkChanged(monitor: Monitor, next: MonitorSettings): boolean {
  return monitor.intervalSec !== next.intervalSec || JSON.stringify(monitor.config) !== JSON.stringify(next.config);
}
