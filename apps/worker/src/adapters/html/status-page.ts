import {
  barQuery,
  HISTORY_RANGES,
  type HistoryRange,
  type OverallStatus,
  type PublicComponent,
  type PublicDay,
  type PublicIncident,
  type PublicIncidentUpdate,
  type PublicMaintenance,
  type PublicSelectedBar,
  type PublicStatusPage,
  type StatusLanguage,
} from "@tiny-uptime/contracts";
import { STATUS_PAGE_CSS } from "./status-page-css";

/** Where "Powered by tiny-uptime" leads. */
export const REPO_URL = "https://github.com/RobertoVillegas/tiny-uptime";

/**
 * The public status page: server-rendered HTML with no JavaScript, so it loads instantly, costs the
 * Worker a millisecond, and works everywhere. Every value from the page's data is escaped. Text is
 * in the page's language. Days follow the page's zone; times of day follow the visitor's when
 * Cloudflare knows it (`viewerZone`), else the page's. `path` is where the range and bar links point;
 * each bar links to the same page with that bar opened, listing the incidents it overlapped.
 */
export function renderStatusPage(
  page: PublicStatusPage,
  opts: { feedPath: string | null; path: string; viewerZone?: string | null },
): string {
  const t = TEXT[page.language];
  const f = formats(page, opts.viewerZone ?? page.timeZone);
  const theme = page.theme === "auto" ? "" : ` data-theme="${page.theme}"`;
  return `<!doctype html>
<html lang="${page.language}"${theme}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description || t.currentStatus(page.title))}">
${opts.feedPath ? `<link rel="alternate" type="application/rss+xml" title="${esc(t.feedTitle(page.title))}" href="${esc(opts.feedPath)}">` : ""}
<style>${STATUS_PAGE_CSS}</style>
</head>
<body>
<main>
<header class="top">
  <div>
    <h1>${esc(page.title)}</h1>
    ${page.description ? `<p class="muted">${esc(page.description)}</p>` : ""}
  </div>
  ${page.externalUrl ? `<a class="link" href="${esc(page.externalUrl)}" rel="noopener">${t.visitSite}</a>` : ""}
</header>
${banner(page.overall, t)}
${page.activeIncidents.map((i) => incident(i, true, t, f)).join("")}
${page.maintenance.map((m) => maintenance(m, t, f)).join("")}
${ranges(page, opts.path, t, f)}
${page.groups.map((g) => group(g.name, g.components, page, opts.path, t, f)).join("")}
${page.selected ? selected(page.selected, page, opts.path, t, f) : ""}
<section class="history">
  <h2>${t.pastIncidents}</h2>
  ${page.pastIncidents.length ? page.pastIncidents.map((i) => incident(i, false, t, f)).join("") : `<p class="muted">${t.noIncidents(page.incidentDays)}</p>`}
</section>
<footer>
  <span>${t.updated} ${f.time(page.updatedAt)} ${esc(f.zone)}</span>
  ${opts.feedPath ? `<a href="${esc(opts.feedPath)}">RSS</a>` : ""}
  ${page.hideBranding ? "" : `<span>${t.poweredBy} <a href="${REPO_URL}" rel="noopener">tiny-uptime</a></span>`}
</footer>
</main>
</body>
</html>`;
}

type Text = {
  currentStatus: (title: string) => string;
  feedTitle: (title: string) => string;
  visitSite: string;
  pastIncidents: string;
  noIncidents: (days: number) => string;
  updated: string;
  poweredBy: string;
  banner: Record<OverallStatus, string>;
  state: Record<PublicComponent["status"], string>;
  range: string;
  daysIn: (zone: string) => string;
  rangeLabel: (days: HistoryRange) => string;
  ago: (n: number, size: "day" | "hour") => string;
  now: (size: "day" | "hour") => string;
  uptime: string;
  uptimeOver: (name: string, share: string, n: number, size: "day" | "hour") => string;
  noData: string;
  checks: (share: string, n: number) => string;
  openBar: string;
  noBarIncidents: (size: "day" | "hour") => string;
  closeBar: string;
  since: string;
  lasted: string;
  slow: string;
  maintenanceNow: string;
  maintenanceLater: string;
  update: Record<PublicIncidentUpdate["status"], string>;
};

const TEXT: Record<StatusLanguage, Text> = {
  en: {
    currentStatus: (title) => `Current status of ${title}`,
    feedTitle: (title) => `${title} incidents`,
    visitSite: "Visit site",
    pastIncidents: "Past incidents",
    noIncidents: (days) => (days === 1 ? "No incidents in the last day." : `No incidents in the last ${days} days.`),
    updated: "Updated",
    poweredBy: "Powered by",
    banner: {
      operational: "All systems operational",
      degraded: "Some systems are slow",
      partial_outage: "Partial outage",
      major_outage: "Major outage",
      maintenance: "Scheduled maintenance in progress",
    },
    state: { up: "Operational", degraded: "Slow", down: "Down", pending: "Checking", paused: "Paused" },
    range: "History",
    daysIn: (zone) => `Each bar is a day in ${zone}.`,
    rangeLabel: (days) => (days === 1 ? "24 hours" : `${days} days`),
    ago: (n, size) => `${n} ${size === "hour" ? "hours" : "days"} ago`,
    now: (size) => (size === "hour" ? "Now" : "Today"),
    uptime: "uptime",
    uptimeOver: (name, share, n, size) => `${name}: ${share} uptime over the last ${n} ${size === "hour" ? "hours" : "days"}`,
    noData: "No data",
    checks: (share, n) => `${share} uptime, ${n} checks`,
    openBar: "Show incidents",
    noBarIncidents: (size) => (size === "hour" ? "No incidents in this hour." : "No incidents on this day."),
    closeBar: "Back to all incidents",
    since: "Since",
    lasted: "lasted",
    slow: "slow responses",
    maintenanceNow: "Maintenance in progress",
    maintenanceLater: "Scheduled maintenance",
    update: { investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved", update: "Update" },
  },
  es: {
    currentStatus: (title) => `Estado actual de ${title}`,
    feedTitle: (title) => `Incidentes de ${title}`,
    visitSite: "Ir al sitio",
    pastIncidents: "Incidentes anteriores",
    noIncidents: (days) => (days === 1 ? "Sin incidentes en el último día." : `Sin incidentes en los últimos ${days} días.`),
    updated: "Actualizado",
    poweredBy: "Hecho con",
    banner: {
      operational: "Todos los sistemas funcionan",
      degraded: "Algunos sistemas van lentos",
      partial_outage: "Falla parcial",
      major_outage: "Falla general",
      maintenance: "Mantenimiento programado en curso",
    },
    state: { up: "Funciona", degraded: "Lento", down: "Caído", pending: "Revisando", paused: "En pausa" },
    range: "Historial",
    daysIn: (zone) => `Cada barra es un día en hora ${zone}.`,
    rangeLabel: (days) => (days === 1 ? "24 horas" : `${days} días`),
    ago: (n, size) => `Hace ${n} ${size === "hour" ? "horas" : "días"}`,
    now: (size) => (size === "hour" ? "Ahora" : "Hoy"),
    uptime: "disponible",
    uptimeOver: (name, share, n, size) =>
      `${name}: ${share} disponible en ${size === "hour" ? "las últimas" : "los últimos"} ${n} ${size === "hour" ? "horas" : "días"}`,
    noData: "Sin datos",
    checks: (share, n) => `${share} disponible, ${n} revisiones`,
    openBar: "Ver incidentes",
    noBarIncidents: (size) => (size === "hour" ? "Sin incidentes en esta hora." : "Sin incidentes este día."),
    closeBar: "Volver a todos los incidentes",
    since: "Desde el",
    lasted: "duró",
    slow: "respuestas lentas",
    maintenanceNow: "Mantenimiento en curso",
    maintenanceLater: "Mantenimiento programado",
    update: {
      investigating: "Investigando",
      identified: "Identificado",
      monitoring: "En observación",
      resolved: "Resuelto",
      update: "Novedad",
    },
  },
};

const TONE: Record<OverallStatus, string> = {
  operational: "up",
  degraded: "warn",
  partial_outage: "down",
  major_outage: "down",
  maintenance: "info",
};

function banner(overall: OverallStatus, t: Text): string {
  return `<div class="banner ${TONE[overall]}" role="status"><span class="dot"></span>${t.banner[overall]}</div>`;
}

/** The page at a range; the page's default range is the bare path. */
function rangeHref(page: PublicStatusPage, path: string, days: HistoryRange): string {
  return days === page.defaultHistoryDays ? path : `${path}?days=${days}`;
}

/** The page at its current range with one bar opened, scrolled to that bar's incidents. */
function barHref(page: PublicStatusPage, path: string, day: string): string {
  const base = rangeHref(page, path, page.historyDays);
  return `${base}${base.includes("?") ? "&" : "?"}${barQuery(day)}#selected`;
}

/** Links to every range, the current one marked. */
function ranges(page: PublicStatusPage, path: string, t: Text, f: Formats): string {
  const link = (days: HistoryRange) => {
    const href = rangeHref(page, path, days);
    const current = days === page.historyDays ? ` aria-current="page"` : "";
    return `<a href="${esc(href)}"${current}>${t.rangeLabel(days)}</a>`;
  };
  const note = page.barSize === "day" && f.dayZone ? `<p class="muted small zone-note">${t.daysIn(esc(f.dayZone))}</p>` : "";
  return `<nav class="ranges" aria-label="${t.range}">${HISTORY_RANGES.map(link).join("")}</nav>${note}`;
}

function group(name: string, components: PublicComponent[], page: PublicStatusPage, path: string, t: Text, f: Formats): string {
  return `<section class="group">
  <h2>${esc(name)}</h2>
  <ul class="components">${components.map((c) => component(c, page, path, t, f)).join("")}</ul>
</section>`;
}

function component(c: PublicComponent, page: PublicStatusPage, path: string, t: Text, f: Formats): string {
  const n = c.days.length;
  const size = page.barSize;
  const long = n > 45;
  const latency = page.showLatency && c.latencyMs !== null ? `<span class="muted num">${c.latencyMs} ms</span>` : "";
  const ago = long
    ? `<span class="wide">${t.ago(n, size)}</span><span class="narrow">${t.ago(Math.ceil(n / 2), size)}</span>`
    : t.ago(n, size);
  return `<li class="component">
  <div class="row">
    <span class="name">${esc(c.name)}</span>
    <span class="state ${c.status}">${t.state[c.status]}</span>
  </div>
  <div class="bars${long ? " long" : ""}" style="--n:${n}" role="group" aria-label="${esc(t.uptimeOver(c.name, pct(c.uptime), n, size))}">${c.days.map((d) => bar(d, page, path, t, f)).join("")}</div>
  <div class="row muted small"><span>${ago}</span><span class="num">${pct(c.uptime)} ${t.uptime}</span>${latency}<span>${t.now(size)}</span></div>
</li>`;
}

function tone(d: PublicDay, page: PublicStatusPage): string {
  return d.uptime === null ? "none" : d.uptime * 100 >= page.okPct ? "up" : d.uptime * 100 >= page.warnPct ? "warn" : "down";
}

function barLabel(d: PublicDay, t: Text): string {
  return d.uptime === null ? t.noData : t.checks(pct(d.uptime), d.checks);
}

function barWhen(day: string, page: PublicStatusPage, f: Formats): string {
  return page.barSize === "hour" ? f.hour(day) : f.date(day);
}

/** A link that opens the bar; the tooltip shows pointer users what its accessible name says. */
function bar(d: PublicDay, page: PublicStatusPage, path: string, t: Text, f: Formats): string {
  const label = barLabel(d, t);
  const when = barWhen(d.day, page, f);
  const current = page.selected?.bar === d.day ? ` aria-current="${page.barSize === "hour" ? "time" : "date"}"` : "";
  return `<a class="bar ${tone(d, page)}" href="${esc(barHref(page, path, d.day))}" aria-label="${esc(`${when}: ${label}. ${t.openBar}`)}"${current}><span class="tip" aria-hidden="true"><b>${when}</b>${label}</span></a>`;
}

/**
 * The opened bar: its span in the visitor's zone, how each component did, and the incidents that
 * overlapped it. On touch screens, which have no hover, this is also where a bar's numbers show.
 */
function selected(s: PublicSelectedBar, page: PublicStatusPage, path: string, t: Text, f: Formats): string {
  const rows = page.groups
    .flatMap((g) => g.components)
    .map((c) => {
      const d = c.days.find((x) => x.day === s.bar);
      return d
        ? `<li><span class="dot ${tone(d, page)}"></span><span class="name">${esc(c.name)}</span><span class="muted num">${barLabel(d, t)}</span></li>`
        : "";
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

function incident(i: PublicIncident, active: boolean, t: Text, f: Formats): string {
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

function maintenance(m: PublicMaintenance, t: Text, f: Formats): string {
  return `<article class="incident info">
  <h3>${m.active ? t.maintenanceNow : t.maintenanceLater}: ${esc(m.name)}</h3>
  <p class="muted small">${f.dateTime(m.startsAt)} – ${f.dateTime(m.endsAt)} ${esc(f.zone)} · ${esc(m.componentNames.join(", "))}</p>
</article>`;
}

function pct(ratio: number | null): string {
  return ratio === null ? "—" : `${(Math.floor(ratio * 10_000) / 100).toFixed(2)}%`;
}

type Formats = {
  zone: string;
  /** The page's zone label when days are cut in a zone other than the one times are shown in. */
  dayZone: string | null;
  date: (day: string) => string;
  hour: (iso: string) => string;
  dateTime: (iso: string) => string;
  time: (iso: string) => string;
};

/**
 * Dates and times in the page's language. A daily bar's date is already the page's local date, so
 * it is shown as is; times of day are shown in `timeZone`, the visitor's when known.
 */
function formats(page: PublicStatusPage, timeZone: string): Formats {
  const lang = page.language;
  const clock = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  const day = new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const hour = new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", ...clock, timeZone });
  const time = new Intl.DateTimeFormat(lang, { ...clock, timeZone });
  const label = (zone: string) =>
    new Intl.DateTimeFormat(lang, { timeZone: zone, timeZoneName: "short" })
      .formatToParts(new Date(page.updatedAt))
      .find((p) => p.type === "timeZoneName")?.value ?? zone;
  const zone = label(timeZone);
  const pageZone = label(page.timeZone);
  return {
    zone,
    dayZone: pageZone === zone ? null : pageZone,
    date: (d) => day.format(new Date(`${d}T00:00:00Z`)),
    hour: (iso) => hour.format(new Date(iso)),
    dateTime: (iso) => hour.format(new Date(iso)),
    time: (iso) => time.format(new Date(iso)),
  };
}

function lasted(from: string, to: string): string {
  const minutes = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
