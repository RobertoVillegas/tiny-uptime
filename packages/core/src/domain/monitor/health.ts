import type { Monitor, MonitorState } from "./monitor";
import { heartbeatDeadline, nextSlot } from "./schedule";

/** Failed checks in a row before a monitor is reported down. */
export const DOWN_AFTER = 2;
/** How soon a failed check is retried, to confirm the failure before alerting. */
export const RETRY_AFTER_MS = 20_000;

export type CheckOutcome = { ok: boolean; latencyMs: number | null; detail: string };

/** A status change that matters to people: going down opens an incident, coming back up resolves it. */
export type Transition = { to: "down"; cause: string } | { to: "up"; resolvedIncidentId: string | null } | null;

export type HealthUpdate = {
  state: MonitorState;
  transition: Transition;
  /** The point recorded in the monitor's history. */
  sample: { ok: boolean; latencyMs: number | null };
};

export function afterCheck(monitor: Monitor, outcome: CheckOutcome, now: number): HealthUpdate {
  const failures = outcome.ok ? 0 : monitor.state.failures + 1;
  const confirmedDown = failures >= DOWN_AFTER;
  const retrying = !outcome.ok && !confirmedDown;
  const state: MonitorState = {
    ...monitor.state,
    failures,
    nextCheckAt: retrying ? now + RETRY_AFTER_MS : nextSlot(monitor.id, monitor.intervalSec, now),
    lastCheckedAt: now,
    lastLatencyMs: outcome.latencyMs,
    lastDetail: outcome.detail,
  };
  const sample = { ok: outcome.ok, latencyMs: outcome.latencyMs };
  if (outcome.ok) return { ...becomeUp(state, now), sample };
  if (confirmedDown) return { ...becomeDown(state, now, outcome.detail), sample };
  return { state, transition: null, sample };
}

export function afterHeartbeat(monitor: Monitor, now: number): HealthUpdate {
  const state: MonitorState = {
    ...monitor.state,
    failures: 0,
    nextCheckAt: heartbeatDeadline(monitor, now),
    lastCheckedAt: now,
    lastDetail: "heartbeat received",
  };
  return { ...becomeUp(state, now), sample: { ok: true, latencyMs: null } };
}

export function afterMissedHeartbeat(monitor: Monitor, now: number): HealthUpdate {
  const detail = "no heartbeat received";
  const state: MonitorState = { ...monitor.state, nextCheckAt: null, lastDetail: detail };
  return { ...becomeDown(state, now, detail), sample: { ok: false, latencyMs: null } };
}

function becomeUp(state: MonitorState, now: number): Omit<HealthUpdate, "sample"> {
  if (state.status === "up") return { state, transition: null };
  return {
    state: { ...state, status: "up", statusChangedAt: now, openIncidentId: null },
    transition: { to: "up", resolvedIncidentId: state.openIncidentId },
  };
}

function becomeDown(state: MonitorState, now: number, cause: string): Omit<HealthUpdate, "sample"> {
  if (state.status === "down") return { state, transition: null };
  return { state: { ...state, status: "down", statusChangedAt: now }, transition: { to: "down", cause } };
}
