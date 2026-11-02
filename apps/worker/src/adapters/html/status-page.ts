import type {
  OverallStatus,
  PublicComponent,
  PublicDay,
  PublicIncident,
  PublicMaintenance,
  PublicStatusPage,
} from "@tiny-uptime/contracts";
import { STATUS_PAGE_CSS } from "./status-page-css";

/**
 * The public status page: server-rendered HTML with no JavaScript, so it loads instantly, costs the
 * Worker a millisecond, and works everywhere. Every value from the page's data is escaped.
 */
export function renderStatusPage(page: PublicStatusPage, opts: { feedPath: string | null }): string {
  const theme = page.theme === "auto" ? "" : ` data-theme="${page.theme}"`;
  return `<!doctype html>
<html lang="en"${theme}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description || `Current status of ${page.title}`)}">
${opts.feedPath ? `<link rel="alternate" type="application/rss+xml" title="${esc(page.title)} incidents" href="${esc(opts.feedPath)}">` : ""}
<style>${STATUS_PAGE_CSS}</style>
</head>
<body>
<main>
<header class="top">
  <div>
    <h1>${esc(page.title)}</h1>
    ${page.description ? `<p class="muted">${esc(page.description)}</p>` : ""}
  </div>
  ${page.externalUrl ? `<a class="link" href="${esc(page.externalUrl)}" rel="noopener">Visit site</a>` : ""}
</header>
${banner(page.overall)}
${page.activeIncidents.map((i) => incident(i, true)).join("")}
${page.maintenance.map(maintenance).join("")}
${page.groups.map((g) => group(g.name, g.components, page)).join("")}
<section class="history">
  <h2>Past incidents</h2>
  ${page.pastIncidents.length ? page.pastIncidents.map((i) => incident(i, false)).join("") : `<p class="muted">No incidents in the last 14 days.</p>`}
</section>
<footer>
  <span>Updated ${time(page.updatedAt)} UTC</span>
  ${opts.feedPath ? `<a href="${esc(opts.feedPath)}">RSS</a>` : ""}
  ${page.hideBranding ? "" : `<span>Powered by tiny-uptime</span>`}
</footer>
</main>
</body>
</html>`;
}

const BANNER: Record<OverallStatus, { text: string; tone: string }> = {
  operational: { text: "All systems operational", tone: "up" },
  degraded: { text: "Some systems are slow", tone: "warn" },
  partial_outage: { text: "Partial outage", tone: "down" },
  major_outage: { text: "Major outage", tone: "down" },
  maintenance: { text: "Scheduled maintenance in progress", tone: "info" },
};

function banner(overall: OverallStatus): string {
  const { text, tone } = BANNER[overall];
  return `<div class="banner ${tone}" role="status"><span class="dot"></span>${text}</div>`;
}

function group(name: string, components: PublicComponent[], page: PublicStatusPage): string {
  return `<section class="group">
  <h2>${esc(name)}</h2>
  <ul class="components">${components.map((c) => component(c, page)).join("")}</ul>
</section>`;
}

const STATUS_TEXT: Record<PublicComponent["status"], string> = {
  up: "Operational",
  degraded: "Slow",
  down: "Down",
  pending: "Checking",
  paused: "Paused",
};

function component(c: PublicComponent, page: PublicStatusPage): string {
  const latency = page.showLatency && c.latencyMs !== null ? `<span class="muted num">${c.latencyMs} ms</span>` : "";
  return `<li class="component">
  <div class="row">
    <span class="name">${esc(c.name)}</span>
    <span class="state ${c.status}">${STATUS_TEXT[c.status]}</span>
  </div>
  <div class="bars" role="img" aria-label="${esc(c.name)}: ${pct(c.uptime)} uptime over the last ${c.days.length} days">${c.days.map((d) => bar(d, page)).join("")}</div>
  <div class="row muted small"><span><span class="wide">${c.days.length}</span><span class="narrow">${Math.ceil(c.days.length / 2)}</span> days ago</span><span class="num">${pct(c.uptime)} uptime</span>${latency}<span>Today</span></div>
</li>`;
}

function bar(d: PublicDay, page: PublicStatusPage): string {
  const tone = d.uptime === null ? "none" : d.uptime * 100 >= page.okPct ? "up" : d.uptime * 100 >= page.warnPct ? "warn" : "down";
  const label = d.uptime === null ? "No data" : `${pct(d.uptime)} uptime, ${d.checks} checks`;
  return `<span class="bar ${tone}" tabindex="0"><span class="tip"><b>${date(d.day)}</b>${label}</span></span>`;
}

function incident(i: PublicIncident, active: boolean): string {
  const updates = i.updates
    .map((u) => `<li><b>${esc(capitalize(u.status))}</b> <span class="muted">${time(u.createdAt)}</span><p>${esc(u.body)}</p></li>`)
    .join("");
  const when = active ? `Since ${dateTime(i.startedAt)}` : `${dateTime(i.startedAt)} · lasted ${lasted(i.startedAt, i.resolvedAt!)}`;
  return `<article class="incident ${active ? (i.kind === "slow" ? "warn" : "down") : "past"}">
  <h3>${esc(i.componentName)}: ${esc(i.kind === "slow" ? "slow responses" : i.title)}</h3>
  <p class="muted small">${when}</p>
  ${updates ? `<ul class="updates">${updates}</ul>` : ""}
</article>`;
}

function maintenance(m: PublicMaintenance): string {
  return `<article class="incident info">
  <h3>${m.active ? "Maintenance in progress" : "Scheduled maintenance"}: ${esc(m.name)}</h3>
  <p class="muted small">${dateTime(m.startsAt)} – ${dateTime(m.endsAt)} UTC · ${esc(m.componentNames.join(", "))}</p>
</article>`;
}

function pct(ratio: number | null): string {
  return ratio === null ? "—" : `${(Math.floor(ratio * 10_000) / 100).toFixed(2)}%`;
}

function date(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
}

function lasted(from: string, to: string): string {
  const minutes = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
