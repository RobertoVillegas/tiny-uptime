import { describe, expect, it } from "vitest";
import { afterCheck, afterHeartbeat, afterMissedHeartbeat, DOWN_AFTER, RETRY_AFTER_MS } from "../src/domain/monitor/health";
import { heartbeatMonitor, httpMonitor } from "./fixtures";

const NOW = 1_700_000_000_000;
const fail = { ok: false, latencyMs: 50, detail: "HTTP 503" };
const pass = { ok: true, latencyMs: 40, detail: "HTTP 200" };

describe("afterCheck", () => {
  it("retries a first failure soon instead of alerting", () => {
    const update = afterCheck(httpMonitor(), fail, NOW);
    expect(update.transition).toBeNull();
    expect(update.state).toMatchObject({ status: "up", failures: 1, nextCheckAt: NOW + RETRY_AFTER_MS });
    expect(update.sample).toEqual({ ok: false, latencyMs: 50 });
  });

  it(`goes down after ${DOWN_AFTER} failures in a row`, () => {
    const update = afterCheck(httpMonitor({}, { failures: DOWN_AFTER - 1 }), fail, NOW);
    expect(update.transition).toEqual({ to: "down", cause: "HTTP 503" });
    expect(update.state).toMatchObject({ status: "down", statusChangedAt: NOW });
    expect(update.state.nextCheckAt).toBeGreaterThan(NOW + RETRY_AFTER_MS);
  });

  it("stays down quietly while it keeps failing", () => {
    expect(afterCheck(httpMonitor({}, { status: "down", failures: 5 }), fail, NOW).transition).toBeNull();
  });

  it("recovers and names the incident to resolve", () => {
    const update = afterCheck(httpMonitor({}, { status: "down", failures: 3, openIncidentId: "i1" }), pass, NOW);
    expect(update.transition).toEqual({ to: "up", resolvedIncidentId: "i1" });
    expect(update.state).toMatchObject({ status: "up", failures: 0, openIncidentId: null });
  });

  it("comes up from pending without an incident", () => {
    expect(afterCheck(httpMonitor({}, { status: "pending" }), pass, NOW).transition).toEqual({ to: "up", resolvedIncidentId: null });
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
    expect(update.transition).toEqual({ to: "down", cause: "no heartbeat received" });
    expect(update.state.nextCheckAt).toBeNull();
  });
});
