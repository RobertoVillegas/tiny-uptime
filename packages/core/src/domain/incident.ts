import { targetOf, type Monitor } from "./monitor/monitor";

/** `down` is an outage; `slow` is a minor incident for responses slower than the monitor allows. */
export type IncidentKind = "down" | "slow";

export type Incident = {
  id: string;
  monitorId: string;
  kind: IncidentKind;
  startedAt: number;
  resolvedAt: number | null;
  cause: string;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  /** False when it opened without alerting anyone: during maintenance or while a dependency was down. */
  notified: boolean;
  reminders: number;
  lastReminderAt: number | null;
  escalatedAt: number | null;
};

export type AlertKind = "opened" | "resolved" | "reminder" | "escalated";

/** What gets sent to alert channels. */
export type AlertEvent = {
  kind: AlertKind;
  incident: { id: string; title: string; startedAt: number; resolvedAt: number | null };
  monitor: { name: string; target: string };
  slow?: true;
  /** Which reminder this is, or the escalation level. */
  count?: number;
  test?: true;
  /** Where the incident is in the panel, when the server knows its public address. */
  link?: string;
};

/** When an open incident nobody acknowledged gets repeated, and when it goes to the escalation channels. */
export type AlertPolicy = {
  /** Minutes between reminders; 0 sends none. */
  reminderEveryMinutes: number;
  /** Minutes before an unacknowledged outage escalates; 0 never escalates. */
  escalateAfterMinutes: number;
  escalationChannelIds: string[];
};

export const DEFAULT_ALERT_POLICY: AlertPolicy = { reminderEveryMinutes: 0, escalateAfterMinutes: 0, escalationChannelIds: [] };

export function newIncident(id: string, monitorId: string, kind: IncidentKind, cause: string, now: number, notified: boolean): Incident {
  return {
    id,
    monitorId,
    kind,
    startedAt: now,
    resolvedAt: null,
    cause,
    acknowledgedAt: null,
    acknowledgedBy: null,
    notified,
    reminders: 0,
    lastReminderAt: null,
    escalatedAt: null,
  };
}

export function alertFor(kind: AlertKind, monitor: Monitor, incident: Incident, now: number): AlertEvent {
  const resolved = kind === "resolved";
  return {
    kind,
    incident: {
      id: incident.id,
      title: resolved ? `${monitor.name} ${incident.kind === "slow" ? "is fast again" : "recovered"}` : incident.cause,
      startedAt: incident.startedAt,
      resolvedAt: resolved ? now : null,
    },
    monitor: { name: monitor.name, target: targetOf(monitor) },
    ...(incident.kind === "slow" ? { slow: true as const } : {}),
    ...(kind === "reminder" ? { count: incident.reminders + 1 } : {}),
    ...(kind === "escalated" ? { count: 1 } : {}),
  };
}

/** What is due for an open, unacknowledged, notified incident: a reminder, an escalation, or nothing. */
export function dueFollowUps(incident: Incident, policy: AlertPolicy, now: number): { remind: boolean; escalate: boolean } {
  if (incident.resolvedAt !== null || incident.acknowledgedAt !== null || !incident.notified) return { remind: false, escalate: false };
  const minute = 60_000;
  const since = incident.lastReminderAt ?? incident.startedAt;
  return {
    remind: policy.reminderEveryMinutes > 0 && now - since >= policy.reminderEveryMinutes * minute,
    escalate:
      incident.kind === "down" &&
      incident.escalatedAt === null &&
      policy.escalateAfterMinutes > 0 &&
      policy.escalationChannelIds.length > 0 &&
      now - incident.startedAt >= policy.escalateAfterMinutes * minute,
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
