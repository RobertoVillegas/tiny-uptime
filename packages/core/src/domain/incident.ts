import { targetOf, type Monitor } from "./monitor/monitor";

export type Incident = { id: string; monitorId: string; startedAt: number; resolvedAt: number | null; cause: string };

/** What gets sent to alert channels when an incident opens or resolves. */
export type AlertEvent = {
  kind: "opened" | "resolved";
  incident: { id: string; title: string; startedAt: number; resolvedAt: number | null };
  monitor: { name: string; target: string };
  test?: true;
};

export function openedAlert(monitor: Monitor, incident: Incident): AlertEvent {
  return {
    kind: "opened",
    incident: { id: incident.id, title: incident.cause, startedAt: incident.startedAt, resolvedAt: null },
    monitor: { name: monitor.name, target: targetOf(monitor) },
  };
}

export function resolvedAlert(monitor: Monitor, incident: Incident, resolvedAt: number): AlertEvent {
  return {
    kind: "resolved",
    incident: { id: incident.id, title: `${monitor.name} recovered`, startedAt: incident.startedAt, resolvedAt },
    monitor: { name: monitor.name, target: targetOf(monitor) },
  };
}

export function testAlert(id: string, now: number): AlertEvent {
  return {
    kind: "opened",
    incident: { id: `test-${id}`, title: "Test alert", startedAt: now, resolvedAt: null },
    monitor: { name: "tiny-uptime test", target: "" },
    test: true,
  };
}
