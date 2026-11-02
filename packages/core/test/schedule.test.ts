import { describe, expect, it } from "vitest";
import { applySettings } from "../src/domain/monitor/settings";
import { nextSlot } from "../src/domain/monitor/schedule";
import { httpMonitor } from "./fixtures";

const NOW = 1_700_000_000_000;

describe("nextSlot", () => {
  it("is always within one interval and keeps the same offset", () => {
    const first = nextSlot("abc", 300, NOW);
    expect(first).toBeGreaterThan(NOW);
    expect(first - NOW).toBeLessThanOrEqual(300_000);
    expect(nextSlot("abc", 300, first)).toBe(first + 300_000);
  });

  it("spreads different monitors over the interval", () => {
    const slots = new Set(Array.from({ length: 40 }, (_, i) => nextSlot(`monitor-${i}`, 300, NOW) % 300_000));
    expect(slots.size).toBeGreaterThan(30);
  });
});

describe("applySettings", () => {
  it("pauses: stops checking and closes the open incident without alerting", () => {
    const monitor = httpMonitor({}, { status: "down", openIncidentId: "i1", failures: 3 });
    const change = applySettings(monitor, { ...monitor, paused: true }, NOW);
    expect(change.closedIncidentIds).toEqual(["i1"]);
    expect(change.state).toMatchObject({ status: "paused", nextCheckAt: null, failures: 0, openIncidentId: null });
  });

  it("resumes as pending and checks right away", () => {
    const monitor = httpMonitor({ paused: true }, { status: "paused", nextCheckAt: null });
    expect(applySettings(monitor, { ...monitor, paused: false }, NOW).state).toMatchObject({ status: "pending", nextCheckAt: NOW });
  });

  it("checks again soon when the target changes, and not when only the name does", () => {
    const monitor = httpMonitor({}, { nextCheckAt: NOW + 50_000 });
    const retarget = { ...monitor, config: { ...monitor.config, url: "https://other.test/" } } as typeof monitor;
    expect(applySettings(monitor, retarget, NOW).state.nextCheckAt).toBe(NOW);
    expect(applySettings(monitor, { ...monitor, name: "Renamed" }, NOW).state.nextCheckAt).toBe(NOW + 50_000);
  });
});
