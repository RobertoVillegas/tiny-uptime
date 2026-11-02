import { alertFor, newIncident, type IncidentKind } from "../../domain/incident";
import { inMaintenance } from "../../domain/maintenance";
import type { HealthEvent, HealthUpdate } from "../../domain/monitor/health";
import type { Monitor, MonitorState } from "../../domain/monitor/monitor";
import { dispatchAlert, monitorChannels } from "./alerts";
import type { WorkspaceDeps } from "./deps";

/**
 * Persists a health update: the monitor's state, its history, and the incidents and alerts its
 * events bring. During maintenance no incident opens. While the monitor's dependency is down,
 * incidents are recorded but nobody is alerted, since the dependency's own alert covers it.
 */
export async function applyHealthUpdate(d: WorkspaceDeps, monitor: Monitor, update: HealthUpdate, now: number): Promise<void> {
  d.history.record(monitor.id, now, update.sample);
  let state = update.state;
  const alerts: (() => Promise<void>)[] = [];

  for (const event of update.events) {
    state = applyEvent(d, monitor, state, event, now, alerts);
  }
  d.monitors.save({ ...monitor, state });
  for (const send of alerts) await send();
}

function applyEvent(
  d: WorkspaceDeps,
  monitor: Monitor,
  state: MonitorState,
  event: HealthEvent,
  now: number,
  alerts: (() => Promise<void>)[],
): MonitorState {
  switch (event.type) {
    case "down":
    case "slow": {
      if (inMaintenance(d.maintenance.list(), monitor.id, now)) return state;
      const kind: IncidentKind = event.type === "down" ? "down" : "slow";
      const notified = !dependencyIsDown(d, monitor);
      const incident = newIncident(d.ids.id(), monitor.id, kind, event.cause, now, notified);
      d.incidents.insert(incident);
      if (notified) alerts.push(() => dispatchAlert(d, alertFor("opened", monitor, incident, now), monitorChannels(d, monitor)));
      return kind === "down" ? { ...state, openIncidentId: incident.id } : { ...state, openSlowIncidentId: incident.id };
    }
    case "up":
    case "fast": {
      if (!event.resolvedIncidentId) return state;
      const incident = d.incidents.get(event.resolvedIncidentId);
      if (!incident || incident.resolvedAt !== null) return state;
      d.incidents.resolve(incident.id, now);
      const quiet = event.type === "fast" && event.quiet;
      if (incident.notified && !quiet)
        alerts.push(() => dispatchAlert(d, alertFor("resolved", monitor, incident, now), monitorChannels(d, monitor)));
      return state;
    }
  }
}

function dependencyIsDown(d: WorkspaceDeps, monitor: Monitor): boolean {
  const parentId = monitor.options.dependsOn;
  if (!parentId) return false;
  return d.monitors.get(parentId)?.state.status === "down";
}
