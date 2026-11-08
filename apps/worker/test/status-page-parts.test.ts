import type { PublicComponent, PublicDay, PublicStatusPage } from "@tiny-uptime/contracts";
import { describe, expect, it } from "vitest";
import { esc } from "../src/adapters/html/escape";
import { barLabel, span, tone } from "../src/adapters/html/status-page/bars";
import { lasted, pct } from "../src/adapters/html/status-page/format";
import { barHref, rangeHref } from "../src/adapters/html/status-page/links";
import { counts } from "../src/adapters/html/status-page/sections";
import { TEXT } from "../src/adapters/html/status-page/text";

const en = TEXT.en;

function day(over: Partial<PublicDay> = {}): PublicDay {
  return { day: "2026-11-03", uptime: 1, checks: 10, ms: null, slow: false, ...over };
}

function page(over: Partial<PublicStatusPage> = {}): PublicStatusPage {
  return {
    title: "Acme",
    description: "",
    theme: "auto",
    language: "en",
    timeZone: "UTC",
    utc: false,
    historyDays: 90,
    defaultHistoryDays: 90,
    barSize: "day",
    incidentDays: 14,
    historyResetAt: null,
    showLatency: true,
    externalUrl: null,
    hideBranding: false,
    okPct: 99.9,
    warnPct: 98,
    overall: "operational",
    groups: [],
    activeIncidents: [],
    pastIncidents: [],
    maintenance: [],
    selected: null,
    updatedAt: "2026-11-03T12:00:00.000Z",
    ...over,
  };
}

function component(name: string, status: PublicComponent["status"]): PublicComponent {
  return { id: name, name, status, uptime: 1, latencyMs: null, days: [] };
}

describe("bar tone", () => {
  it("follows the page's thresholds, and marks a slow bar that stayed up", () => {
    const p = page({ okPct: 99.9, warnPct: 98 });
    expect(tone(day({ uptime: null }), p)).toBe("none");
    expect(tone(day({ uptime: 1 }), p)).toBe("up");
    expect(tone(day({ uptime: 0.999 }), p)).toBe("up");
    expect(tone(day({ uptime: 0.99 }), p)).toBe("warn");
    expect(tone(day({ uptime: 0.97 }), p)).toBe("down");
    expect(tone(day({ uptime: 1, slow: true }), p)).toBe("warn");
    expect(tone(day({ uptime: 0.5, slow: true }), p)).toBe("down");
  });
});

describe("bar label", () => {
  it("reads uptime and checks, then the average and whether it was slow", () => {
    expect(barLabel(day({ uptime: null }), en)).toBe("No data");
    expect(barLabel(day({ uptime: 1, checks: 24 }), en)).toBe("100.00% uptime, 24 checks");
    expect(barLabel(day({ ms: 840, slow: true }), en)).toBe("100.00% uptime, 10 checks. 840 ms average (slow)");
    // A page that hides latency still says the bar was slow.
    expect(barLabel(day({ ms: null, slow: true }), en)).toBe("100.00% uptime, 10 checks. slow");
  });
});

describe("formats", () => {
  it("rounds uptime down so a near miss never shows as 100%", () => {
    expect(pct(null)).toBe("—");
    expect(pct(0.99999)).toBe("99.99%");
    expect(pct(1)).toBe("100.00%");
  });

  it("says how long an incident lasted, at least a minute", () => {
    expect(lasted("2026-11-03T10:00:00Z", "2026-11-03T10:00:10Z")).toBe("1 min");
    expect(lasted("2026-11-03T10:00:00Z", "2026-11-03T10:45:00Z")).toBe("45 min");
    expect(lasted("2026-11-03T10:00:00Z", "2026-11-03T12:05:00Z")).toBe("2 h 5 min");
  });

  it("counts hours back in days once there are two days of them", () => {
    expect(span(24, "hour")).toEqual([24, "hour"]);
    expect(span(168, "hour")).toEqual([7, "day"]);
    expect(span(90, "day")).toEqual([90, "day"]);
  });

  it("escapes text for content and attributes", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe("&#60;a href=&#34;x&#34;&#62;&#39;&#38;&#39;&#60;/a&#62;");
  });
});

describe("links", () => {
  it("keeps the default range and local time as the bare path", () => {
    const p = page({ historyDays: 90, defaultHistoryDays: 90 });
    expect(rangeHref(p, "/s/acme", 90)).toBe("/s/acme");
    expect(rangeHref(p, "/s/acme", 7)).toBe("/s/acme?days=7");
    expect(rangeHref(p, "/s/acme", 7, true)).toBe("/s/acme?days=7&tz=utc");
    expect(rangeHref(page({ utc: true }), "/s/acme", 90)).toBe("/s/acme?tz=utc");
  });

  it("opens a bar at the current range, scrolled to its incidents", () => {
    expect(barHref(page(), "/s/acme", "2026-11-03")).toBe("/s/acme?day=2026-11-03#selected");
    const week = page({ historyDays: 7, barSize: "hour" });
    expect(barHref(week, "/s/acme", "2026-11-03T14:00:00.000Z")).toBe("/s/acme?days=7&hour=2026-11-03T14#selected");
  });
});

describe("state counts", () => {
  it("counts a component under active maintenance only there, and skips checking and paused ones", () => {
    const p = page({
      groups: [
        {
          name: "API",
          components: [
            component("Web", "up"),
            component("API", "down"),
            component("DB", "down"),
            component("Queue", "pending"),
            component("Cron", "paused"),
          ],
        },
      ],
      maintenance: [{ name: "DB upgrade", startsAt: "", endsAt: "", active: true, componentNames: ["DB"] }],
    });
    const html = counts(p, en);
    expect(html).toContain(`<li class="up"><b class="num">1</b>Operational</li>`);
    expect(html).toContain(`<li><b class="num">0</b>Slow</li>`);
    expect(html).toContain(`<li class="down"><b class="num">1</b>Down</li>`);
    expect(html).toContain(`<li class="maintenance"><b class="num">1</b>In maintenance</li>`);
  });

  it("shows nothing for a page with a single component", () => {
    expect(counts(page({ groups: [{ name: "All", components: [component("Web", "up")] }] }), en)).toBe("");
  });
});
