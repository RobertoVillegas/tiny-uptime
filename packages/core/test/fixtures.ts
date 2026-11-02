import type { Monitor } from "../src/domain/monitor/monitor";

export function httpMonitor(overrides: Partial<Monitor> = {}, state: Partial<Monitor["state"]> = {}): Monitor {
  return {
    id: "m1",
    type: "http",
    name: "Site",
    intervalSec: 60,
    paused: false,
    public: false,
    config: { url: "https://site.test/", method: "GET", headers: {}, expectedStatus: [], timeoutMs: 10_000 },
    heartbeatToken: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
    state: { status: "up", failures: 0, openIncidentId: null, nextCheckAt: 0, lastCheckedAt: null, lastLatencyMs: null, lastDetail: null, statusChangedAt: 0, ...state },
  } as Monitor;
}

export function heartbeatMonitor(state: Partial<Monitor["state"]> = {}): Monitor {
  return httpMonitor({ type: "heartbeat", config: { graceSec: 30 }, heartbeatToken: "t" } as Partial<Monitor>, state);
}
