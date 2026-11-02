import type { Monitor, MonitorState } from "./monitor";
import { heartbeatDeadline, nextSlot } from "./schedule";

/** How soon a check is repeated to confirm a failure or a recovery before acting on it. */
export const RETRY_AFTER_MS = 20_000;

export type CheckOutcome = { ok: boolean; latencyMs: number | null; detail: string };

/**
 * Changes that matter to people. Going down opens an incident and coming back up resolves it;
 * being slow for long enough opens a separate, minor incident that resolves when speed returns.
 */
export type HealthEvent =
  | { type: "down"; cause: string }
  | { type: "up"; resolvedIncidentId: string | null }
  | { type: "slow"; cause: string }
  /** `quiet` when the slow incident closes because the monitor went down: the down alert says enough. */
  | { type: "fast"; resolvedIncidentId: string; quiet: boolean };

export type HealthUpdate = {
  state: MonitorState;
  events: HealthEvent[];
  /** The point recorded in the monitor's history. */
  sample: { ok: boolean; latencyMs: number | null };
};

export function afterCheck(monitor: Monitor, outcome: CheckOutcome, now: number): HealthUpdate {
  const { failureThreshold, recoveryThreshold } = monitor.options;
  const previous = monitor.state;
  const failures = outcome.ok ? 0 : previous.failures + 1;
  const successes = outcome.ok ? previous.successes + 1 : 0;
  const confirmedDown = failures >= failureThreshold;
  const recovering = outcome.ok && previous.status === "down" && successes < recoveryThreshold;
  const unconfirmed = (!outcome.ok && !confirmedDown) || recovering;

  let state: MonitorState = {
    ...previous,
    failures,
    successes,
    nextCheckAt: unconfirmed ? now + RETRY_AFTER_MS : nextSlot(monitor.id, monitor.intervalSec, now),
    lastCheckedAt: now,
    lastLatencyMs: outcome.latencyMs,
    lastDetail: outcome.detail,
  };
  const events: HealthEvent[] = [];
  const sample = { ok: outcome.ok, latencyMs: outcome.latencyMs };

  if (!outcome.ok) {
    if (confirmedDown && previous.status !== "down") {
      state = closeSlow(state, events, false);
      state = { ...state, status: "down", statusChangedAt: now };
      events.push({ type: "down", cause: outcome.detail });
    }
    return { state, events, sample };
  }
  if (recovering) return { state, events, sample };

  if (previous.status === "down" || previous.status === "pending" || previous.status === "paused") {
    events.push({ type: "up", resolvedIncidentId: previous.status === "down" ? previous.openIncidentId : null });
    state = { ...state, statusChangedAt: now, openIncidentId: null };
  }
  state = applySpeed(monitor, state, outcome.latencyMs, events, now);
  return { state, events, sample };
}

export function afterHeartbeat(monitor: Monitor, now: number): HealthUpdate {
  const previous = monitor.state;
  const events: HealthEvent[] = [];
  let state: MonitorState = {
    ...previous,
    failures: 0,
    successes: previous.successes + 1,
    nextCheckAt: heartbeatDeadline(monitor, now),
    lastCheckedAt: now,
    lastDetail: "heartbeat received",
  };
  if (previous.status !== "up") {
    events.push({ type: "up", resolvedIncidentId: previous.status === "down" ? previous.openIncidentId : null });
    state = { ...state, status: "up", statusChangedAt: now, openIncidentId: null };
  }
  return { state, events, sample: { ok: true, latencyMs: null } };
}

export function afterMissedHeartbeat(monitor: Monitor, now: number): HealthUpdate {
  const detail = "no heartbeat received";
  const state: MonitorState = {
    ...monitor.state,
    failures: monitor.state.failures + 1,
    successes: 0,
    nextCheckAt: null,
    lastDetail: detail,
  };
  if (monitor.state.status === "down") return { state, events: [], sample: { ok: false, latencyMs: null } };
  return {
    state: { ...state, status: "down", statusChangedAt: now },
    events: [{ type: "down", cause: detail }],
    sample: { ok: false, latencyMs: null },
  };
}

/** Up or degraded by response time, opening or closing the slow incident at the edges. */
function applySpeed(monitor: Monitor, state: MonitorState, latencyMs: number | null, events: HealthEvent[], now: number): MonitorState {
  const { slowThresholdMs, slowAlertAfter } = monitor.options;
  const slow = slowThresholdMs !== null && latencyMs !== null && latencyMs > slowThresholdMs;
  const slowStreak = slow ? state.slowStreak + 1 : 0;
  const status = slow ? "degraded" : "up";
  let next: MonitorState = { ...state, slowStreak, status, statusChangedAt: status === monitor.state.status ? state.statusChangedAt : now };
  if (slow && slowStreak >= slowAlertAfter && !next.openSlowIncidentId) {
    events.push({ type: "slow", cause: `responding in ${latencyMs} ms, slower than ${slowThresholdMs} ms` });
  }
  if (!slow) next = closeSlow(next, events, true);
  return next;
}

/** Closes an open slow incident: with an alert when speed returns, quietly when the monitor goes down. */
function closeSlow(state: MonitorState, events: HealthEvent[], announce: boolean): MonitorState {
  if (!state.openSlowIncidentId) return { ...state, slowStreak: 0 };
  events.push({ type: "fast", resolvedIncidentId: state.openSlowIncidentId, quiet: !announce });
  return { ...state, slowStreak: 0, openSlowIncidentId: null };
}
