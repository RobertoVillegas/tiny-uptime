import type { HealthUpdate } from "../../domain/monitor/health";
import type { Monitor } from "../../domain/monitor/monitor";
import { openedAlert, resolvedAlert, type Incident } from "../../domain/incident";
import { dispatchAlert } from "./alerts";
import type { WorkspaceDeps } from "./deps";

/** Persists a health update: the monitor's state, its history, and the incident and alert a transition brings. */
export async function applyHealthUpdate(d: WorkspaceDeps, monitor: Monitor, update: HealthUpdate, now: number): Promise<void> {
  d.history.record(monitor.id, now, update.sample);
  const { transition } = update;

  if (transition?.to === "down") {
    const incident: Incident = { id: d.ids.id(), monitorId: monitor.id, startedAt: now, resolvedAt: null, cause: transition.cause };
    d.incidents.insert(incident);
    d.monitors.save({ ...monitor, state: { ...update.state, openIncidentId: incident.id } });
    await dispatchAlert(d, openedAlert(monitor, incident));
    return;
  }

  d.monitors.save({ ...monitor, state: update.state });
  if (transition?.to === "up" && transition.resolvedIncidentId) {
    const incident = d.incidents.get(transition.resolvedIncidentId);
    if (!incident) return;
    d.incidents.resolve(incident.id, now);
    await dispatchAlert(d, resolvedAlert(monitor, incident, now));
  }
}
