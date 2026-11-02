import { describe, expect, it } from "vitest";
import { inMaintenance, isActive, isFinished, zonedTime, type MaintenanceWindow } from "../src/domain/maintenance";

const utc = (iso: string) => new Date(iso).getTime();

function window(overrides: Partial<MaintenanceWindow>): MaintenanceWindow {
  return { id: "w", name: "Deploy", monitorIds: [], startsAt: 0, endsAt: 0, recurrence: null, createdAt: 0, ...overrides };
}

describe("one-off windows", () => {
  const w = window({ startsAt: utc("2026-11-02T10:00:00Z"), endsAt: utc("2026-11-02T11:00:00Z") });

  it("is active between its start and end", () => {
    expect(isActive(w, utc("2026-11-02T09:59:59Z"))).toBe(false);
    expect(isActive(w, utc("2026-11-02T10:00:00Z"))).toBe(true);
    expect(isActive(w, utc("2026-11-02T10:59:59Z"))).toBe(true);
    expect(isActive(w, utc("2026-11-02T11:00:00Z"))).toBe(false);
    expect(isFinished(w, utc("2026-11-02T11:00:00Z"))).toBe(true);
  });

  it("covers only its monitors, or all when it lists none", () => {
    const now = utc("2026-11-02T10:30:00Z");
    expect(inMaintenance([{ ...w, monitorIds: ["a"] }], "a", now)).toBe(true);
    expect(inMaintenance([{ ...w, monitorIds: ["a"] }], "b", now)).toBe(false);
    expect(inMaintenance([w], "b", now)).toBe(true);
  });
});

describe("repeating windows", () => {
  // Every Sunday 02:00–03:00 in Mexico City (UTC-6, no DST since 2022).
  const sundays = window({
    startsAt: zonedTime(2026, 11, 1, 2, 0, "America/Mexico_City"),
    endsAt: zonedTime(2026, 11, 1, 3, 0, "America/Mexico_City"),
    recurrence: { frequency: "weekly", days: [0], timezone: "America/Mexico_City", until: null },
  });

  it("repeats on its weekdays at the same local time", () => {
    expect(isActive(sundays, utc("2026-11-08T08:30:00Z"))).toBe(true); // Sunday 02:30 local
    expect(isActive(sundays, utc("2026-11-09T08:30:00Z"))).toBe(false); // Monday
    expect(isActive(sundays, utc("2026-11-08T09:00:00Z"))).toBe(false); // 03:00 local, ended
  });

  it("keeps local time across daylight saving changes", () => {
    // Daily 01:30–02:30 in New York: EDT (UTC-4) before Nov 1 2026, EST (UTC-5) after.
    const nightly = window({
      startsAt: zonedTime(2026, 10, 30, 1, 30, "America/New_York"),
      endsAt: zonedTime(2026, 10, 30, 2, 30, "America/New_York"),
      recurrence: { frequency: "daily", days: [], timezone: "America/New_York", until: null },
    });
    expect(nightly.startsAt).toBe(utc("2026-10-30T05:30:00Z"));
    expect(isActive(nightly, utc("2026-11-03T06:45:00Z"))).toBe(true); // 01:45 EST
    expect(isActive(nightly, utc("2026-11-03T05:45:00Z"))).toBe(false); // 00:45 EST
  });

  it("covers an occurrence that runs past midnight", () => {
    const lateNight = window({
      startsAt: utc("2026-11-02T23:00:00Z"),
      endsAt: utc("2026-11-03T01:00:00Z"),
      recurrence: { frequency: "weekly", days: [1], timezone: "UTC", until: null },
    });
    expect(isActive(lateNight, utc("2026-11-10T00:30:00Z"))).toBe(true); // Monday's occurrence, Tuesday 00:30
  });

  it("stops after its until date", () => {
    const limited = { ...sundays, recurrence: { ...sundays.recurrence!, until: utc("2026-11-10T00:00:00Z") } };
    expect(isActive(limited, utc("2026-11-08T08:30:00Z"))).toBe(true);
    expect(isActive(limited, utc("2026-11-15T08:30:00Z"))).toBe(false);
  });
});
