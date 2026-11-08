import type { PublicStatusPage } from "@tiny-uptime/contracts";
import { esc } from "./escape";
import { STATUS_PAGE_CSS } from "./status-page/css";
import { formats } from "./status-page/format";
import { banner, counts, group, incident, maintenance, ranges, selected } from "./status-page/sections";
import { TEXT } from "./status-page/text";

/** Where "Powered by tiny-uptime" leads. */
export const REPO_URL = "https://github.com/RobertoVillegas/tiny-uptime";

/**
 * The public status page: server-rendered HTML with no JavaScript, so it loads instantly, costs the
 * Worker a millisecond, and works everywhere. Every value from the page's data is escaped. Text is
 * in the page's language. Days follow the page's zone; times of day follow the visitor's when
 * Cloudflare knows it (`viewerZone`), else the page's. A visitor who picks UTC gets both in UTC.
 * `path` is where the range, zone and bar links point; each bar links to the same page with that bar
 * opened, listing the incidents it overlapped.
 */
export function renderStatusPage(
  page: PublicStatusPage,
  opts: { feedPath: string | null; path: string; viewerZone?: string | null },
): string {
  const t = TEXT[page.language];
  const f = page.utc ? formats(page, "UTC", "UTC") : formats(page, opts.viewerZone ?? page.timeZone, page.timeZone);
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
${counts(page, t)}
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
