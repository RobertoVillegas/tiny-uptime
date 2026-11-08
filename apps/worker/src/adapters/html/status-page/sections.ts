import {
  HISTORY_RANGES,
  type HistoryRange,
  type OverallStatus,
  type PublicComponent,
  type PublicIncident,
  type PublicMaintenance,
  type PublicSelectedBar,
  type PublicStatusPage,
} from "@tiny-uptime/contracts";
import { esc } from "../escape";
import { bar, barLabel, barWhen, hourBar, span, tone } from "./bars";
import { phoneBars } from "./css";
import { lasted, pct, type Formats } from "./format";
import { rangeHref } from "./links";
import { COUNTS, type Count, type Text } from "./text";

const TONE: Record<OverallStatus, string> = {
  operational: "up",
  degraded: "warn",
  partial_outage: "down",
  major_outage: "down",
  maintenance: "info",
};

export function banner(overall: OverallStatus, t: Text): string {
  return `<div class="banner ${TONE[overall]}" role="status"><span class="dot"></span>${t.banner[overall]}</div>`;
}

/** Links to every range, the current one marked. */
export function ranges(page: PublicStatusPage, path: string, t: Text, f: Formats): string {
  const link = (days: HistoryRange) => {
    const href = rangeHref(page, path, days);
    const current = days === page.historyDays ? ` aria-current="page"` : "";
    return `<a href="${esc(href)}"${current}>${t.rangeLabel(days)}</a>`;
  };
  const zone = (utc: boolean, label: string) =>
    `<a href="${esc(rangeHref(page, path, page.historyDays, utc))}"${utc === page.utc ? ` aria-current="true"` : ""}>${label}</a>`;
  const note = page.barSize === "day" && f.dayZone ? `<p class="muted small zone-note">${t.daysIn(esc(f.dayZone))}</p>` : "";
  return `<div class="pickers"><nav class="ranges zones" aria-label="${t.zonePicker}">${zone(false, t.localTime)}${zone(true, "UTC")}</nav><nav class="ranges" aria-label="${t.range}">${HISTORY_RANGES.map(link).join("")}</nav></div>${note}`;
}

const CHEVRON = `<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * How many components are in each state, read at a glance above the groups. A component under
 * maintenance counts there and nowhere else; checking and paused ones are left out. A page with a
 * single component has nothing to tally, so it shows none.
 */
export function counts(page: PublicStatusPage, t: Text): string {
  const all = page.groups.flatMap((g) => g.components);
  if (all.length < 2) return "";
  const held = new Set(page.maintenance.filter((m) => m.active).flatMap((m) => m.componentNames));
  const tally: Record<Count, number> = { up: 0, degraded: 0, down: 0, maintenance: 0 };
  for (const c of all) {
    if (held.has(c.name)) tally.maintenance++;
    else if (c.status === "up" || c.status === "degraded" || c.status === "down") tally[c.status]++;
  }
  return `<ul class="counts">${COUNTS.map((k) => `<li${tally[k] ? ` class="${k}"` : ""}><b class="num">${tally[k]}</b>${t.counts[k]}</li>`).join("")}</ul>`;
}

/** A group visitors can fold away; it opens on every visit, so nothing stays hidden by accident. */
export function group(name: string, components: PublicComponent[], page: PublicStatusPage, path: string, t: Text, f: Formats): string {
  return `<details class="group" open>
  <summary><h2>${CHEVRON}${esc(name)}</h2><span class="muted small">${t.services(components.length)}</span></summary>
  <ul class="components">${components.map((c) => component(c, page, path, t, f)).join("")}</ul>
</details>`;
}

function component(c: PublicComponent, page: PublicStatusPage, path: string, t: Text, f: Formats): string {
  const n = c.days.length;
  const size = page.barSize;
  const narrow = phoneBars(page.historyDays, n);
  const latency = page.showLatency && c.latencyMs !== null ? `<span class="muted num">${c.latencyMs} ms</span>` : "";
  const ago =
    narrow < n
      ? `<span class="wide">${t.ago(...span(n, size))}</span><span class="narrow">${t.ago(...span(narrow, size))}</span>`
      : t.ago(...span(n, size));
  return `<li class="component">
  <div class="row">
    <span class="name">${esc(c.name)}</span>
    <span class="state ${c.status}">${t.state[c.status]}</span>
  </div>
  <div class="bars r${page.historyDays}" style="--n:${n}" role="group" aria-label="${esc(t.uptimeOver(c.name, pct(c.uptime), ...span(n, size)))}">${c.days.map((d) => bar(d, page, path, t, f)).join("")}</div>
  <div class="row muted small"><span>${ago}</span><span class="num">${pct(c.uptime)} ${t.uptime}</span>${latency}<span>${t.now(size)}</span></div>
</li>`;
}

/**
 * The opened bar: its span in the visitor's zone, how each component did, and the incidents that
 * overlapped it. On touch screens, which have no hover, this is also where a bar's numbers show.
 */
export function selected(s: PublicSelectedBar, page: PublicStatusPage, path: string, t: Text, f: Formats): string {
  const rows = page.groups
    .flatMap((g) => g.components)
    .map((c) => {
      const d = c.days.find((x) => x.day === s.bar);
      if (!d) return "";
      const hours = s.hours?.[c.id];
      const strip = hours
        ? `<div class="bars hours" style="--n:${hours.length}" role="group" aria-label="${esc(t.hoursOf(c.name))}">${hours.map((h) => hourBar(h, page, t, f)).join("")}</div>`
        : "";
      return `<li><div class="row"><span class="dot ${tone(d, page)}"></span><span class="name">${esc(c.name)}</span><span class="muted num">${barLabel(d, t)}</span></div>${strip}</li>`;
    })
    .join("");
  const incidents = s.incidents.length
    ? s.incidents.map((i) => incident(i, i.resolvedAt === null, t, f)).join("")
    : `<p class="muted">${t.noBarIncidents(page.barSize)}</p>`;
  return `<section class="selected" id="selected" aria-labelledby="selected-title">
  <div class="row">
    <h2 id="selected-title">${barWhen(s.bar, page, f)}</h2>
    <a class="link small" href="${esc(rangeHref(page, path, page.historyDays))}">${t.closeBar}</a>
  </div>
  <p class="muted small">${f.dateTime(s.from)} – ${f.dateTime(s.to)} ${esc(f.zone)}</p>
  <ul class="bar-summary">${rows}</ul>
  ${incidents}
</section>`;
}

export function incident(i: PublicIncident, active: boolean, t: Text, f: Formats): string {
  const updates = i.updates
    .map((u) => `<li><b>${t.update[u.status]}</b> <span class="muted">${f.time(u.createdAt)}</span><p>${esc(u.body)}</p></li>`)
    .join("");
  const when = active
    ? `${t.since} ${f.dateTime(i.startedAt)}`
    : `${f.dateTime(i.startedAt)} · ${t.lasted} ${lasted(i.startedAt, i.resolvedAt!)}`;
  return `<article class="incident ${active ? (i.kind === "slow" ? "warn" : "down") : "past"}">
  <h3>${i.componentName ? `${esc(i.componentName)}: ` : ""}${esc(i.kind === "slow" && !i.declared ? t.slow : i.title)}</h3>
  <p class="muted small">${when}</p>
  ${updates ? `<ul class="updates">${updates}</ul>` : ""}
</article>`;
}

export function maintenance(m: PublicMaintenance, t: Text, f: Formats): string {
  return `<article class="incident info">
  <h3>${m.active ? t.maintenanceNow : t.maintenanceLater}: ${esc(m.name)}</h3>
  <p class="muted small">${f.dateTime(m.startsAt)} – ${f.dateTime(m.endsAt)} ${esc(f.zone)} · ${esc(m.componentNames.join(", "))}</p>
</article>`;
}
