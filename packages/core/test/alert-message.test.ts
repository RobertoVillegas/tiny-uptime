import { describe, expect, it } from "vitest";
import { duration, formatAlert } from "../src/domain/alert-message";
import { testAlert, type AlertEvent } from "../src/domain/incident";

const start = Date.UTC(2026, 10, 2, 10, 0);

function event(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    kind: "opened",
    incident: { id: "i1", title: "HTTP 503", startedAt: start, resolvedAt: null },
    monitor: { name: "Site", target: "https://site.example/" },
    ...overrides,
  };
}

describe("formatAlert", () => {
  it("words an outage as OpenUptime does", () => {
    const message = formatAlert(event());
    expect(message).toMatchObject({ tone: "down", title: "Site is down", emoji: "🔴", text: "🔴 Site is down — HTTP 503" });
    expect(message.body).toBe(
      [
        "The monitor failed its consecutive checks, so an incident was opened.",
        "",
        "Monitor: Site",
        "Target: https://site.example/",
        "Cause: HTTP 503",
        "Started: 2026-11-02 10:00 UTC",
      ].join("\n"),
    );
  });

  it("says when an outage recovered and how long it lasted", () => {
    const resolvedAt = start + 125 * 60_000;
    const message = formatAlert(event({ kind: "resolved", incident: { id: "i1", title: "Site recovered", startedAt: start, resolvedAt } }));
    expect(message).toMatchObject({ tone: "up", title: "Site has recovered", text: "✅ Site has recovered" });
    expect(message.body).toContain("Downtime: 2 h 5 min\nResolved: 2026-11-02 12:05 UTC");
    expect(message.body).not.toContain("Cause:");
  });

  it("words slow responses and their end", () => {
    expect(formatAlert(event({ slow: true, incident: { ...event().incident, title: "slower than 500 ms" } })).text).toBe(
      "🟡 Site is responding slowly — slower than 500 ms",
    );
    const fast = formatAlert(event({ kind: "resolved", slow: true, incident: { ...event().incident, resolvedAt: start + 60_000 } }));
    expect(fast).toMatchObject({ tone: "up", title: "Site is back to normal", text: "✅ Site is back to normal" });
    expect(fast.body).toContain("Slow for: 1 min");
  });

  it("numbers reminders and announces escalations", () => {
    expect(formatAlert(event({ kind: "reminder", count: 3 })).text).toBe(
      "⏰ Site is still down and nobody has acknowledged it — reminder 3",
    );
    expect(formatAlert(event({ kind: "reminder", count: 1, slow: true })).title).toBe("Site is still responding slowly");
    const escalated = formatAlert(event({ kind: "escalated", count: 1 }));
    expect(escalated).toMatchObject({
      tone: "down",
      emoji: "🚨",
      text: "🚨 Site is still down and nobody has acknowledged it — escalated to you",
    });
    expect(escalated.body).toMatch(/^Nobody acknowledged this incident in time/);
  });

  it("reads a test as a connection check, not an incident", () => {
    const message = formatAlert(testAlert("abc", start));
    expect(message).toMatchObject({
      tone: "test",
      title: "Test alert from tiny-uptime",
      text: "🔔 Test alert from tiny-uptime — this channel is connected.",
    });
    expect(message.body).not.toContain("Cause");
  });
});

describe("duration", () => {
  it("rounds to minutes, at least one", () => {
    expect(duration(0)).toBe("1 min");
    expect(duration(59 * 60_000)).toBe("59 min");
    expect(duration(60 * 60_000)).toBe("1 h");
    expect(duration(61 * 60_000)).toBe("1 h 1 min");
  });
});
