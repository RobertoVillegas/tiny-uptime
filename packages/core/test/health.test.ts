import { describe, expect, it } from "vitest";
import { afterCheck, afterHeartbeat, afterMissedHeartbeat, RETRY_AFTER_MS } from "../src/domain/monitor/health";
import { heartbeatMonitor, httpMonitor } from "./fixtures";

const NOW = 1_700_000_000_000;
const fail = { ok: false, latencyMs: 50, detail: "HTTP 503" };
const pass = (latencyMs = 40) => ({ ok: true, latencyMs, detail: "HTTP 200" });

describe("down and up", () => {
  it("retries a first failure soon instead of alerting", () => {
    const update = afterCheck(httpMonitor(), fail, NOW);
    expect(update.events).toEqual([]);
    expect(update.state).toMatchObject({ status: "up", failures: 1, nextCheckAt: NOW + RETRY_AFTER_MS });
    expect(update.sample).toEqual({ ok: false, latencyMs: 50 });
  });

  it("goes down after the monitor's failure threshold", () => {
    const update = afterCheck(httpMonitor({}, { failures: 1 }), fail, NOW);
    expect(update.events).toEqual([{ type: "down", cause: "HTTP 503" }]);
    expect(update.state).toMatchObject({ status: "down", statusChangedAt: NOW });
    const strict = httpMonitor({ options: { ...httpMonitor().options, failureThreshold: 3 } }, { failures: 1 });
    expect(afterCheck(strict, fail, NOW).events).toEqual([]);
  });

  it("stays down quietly while it keeps failing", () => {
    expect(afterCheck(httpMonitor({}, { status: "down", failures: 5 }), fail, NOW).events).toEqual([]);
  });

  it("recovers after the recovery threshold and names the incident to resolve", () => {
    const down = { status: "down" as const, failures: 3, openIncidentId: "i1" };
    expect(afterCheck(httpMonitor({}, down), pass(), NOW).events).toEqual([{ type: "up", resolvedIncidentId: "i1" }]);

    const cautious = httpMonitor({ options: { ...httpMonitor().options, recoveryThreshold: 2 } }, down);
    const first = afterCheck(cautious, pass(), NOW);
    expect(first.events).toEqual([]);
    expect(first.state).toMatchObject({ status: "down", successes: 1, nextCheckAt: NOW + RETRY_AFTER_MS });
    expect(afterCheck({ ...cautious, state: first.state }, pass(), NOW).events).toEqual([{ type: "up", resolvedIncidentId: "i1" }]);
  });

  it("comes up from pending without an incident", () => {
    expect(afterCheck(httpMonitor({}, { status: "pending" }), pass(), NOW).events).toEqual([{ type: "up", resolvedIncidentId: null }]);
  });
});

const slowMonitor = (state = {}) => httpMonitor({ options: { ...httpMonitor().options, slowThresholdMs: 500, slowAlertAfter: 2 } }, state);

describe("slow responses", () => {
  it("marks the monitor degraded and opens a slow incident after enough slow checks", () => {
    const first = afterCheck(slowMonitor(), pass(900), NOW);
    expect(first.state).toMatchObject({ status: "degraded", slowStreak: 1 });
    expect(first.events).toEqual([]);
    const second = afterCheck(slowMonitor(first.state), pass(900), NOW);
    expect(second.events).toEqual([{ type: "slow", cause: "responding in 900 ms, slower than 500 ms" }]);
  });

  it("resolves the slow incident when speed returns", () => {
    const update = afterCheck(slowMonitor({ status: "degraded", slowStreak: 4, openSlowIncidentId: "s1" }), pass(100), NOW);
    expect(update.state).toMatchObject({ status: "up", slowStreak: 0, openSlowIncidentId: null });
    expect(update.events).toEqual([{ type: "fast", resolvedIncidentId: "s1", quiet: false }]);
  });

  it("closes the slow incident quietly when the monitor goes down", () => {
    const update = afterCheck(slowMonitor({ status: "degraded", failures: 1, openSlowIncidentId: "s1" }), fail, NOW);
    expect(update.events).toEqual([
      { type: "fast", resolvedIncidentId: "s1", quiet: true },
      { type: "down", cause: "HTTP 503" },
    ]);
  });
});

describe("heartbeats", () => {
  it("moves the deadline to interval plus grace after a ping", () => {
    const update = afterHeartbeat(heartbeatMonitor({ status: "pending" }), NOW);
    expect(update.state.nextCheckAt).toBe(NOW + (60 + 30) * 1000);
    expect(update.state.status).toBe("up");
  });

  it("goes down when the deadline passes and waits for the next ping", () => {
    const update = afterMissedHeartbeat(heartbeatMonitor(), NOW);
    expect(update.events).toEqual([{ type: "down", cause: "no heartbeat received" }]);
    expect(update.state.nextCheckAt).toBeNull();
  });
});
