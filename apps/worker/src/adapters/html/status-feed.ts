import type { PublicIncident, PublicStatusPage } from "@tiny-uptime/contracts";
import { esc } from "./status-page";

/** An RSS 2.0 feed of a status page's incidents, newest first, with their public updates. */
export function renderStatusFeed(page: PublicStatusPage, link: string): string {
  const incidents = [...page.activeIncidents, ...page.pastIncidents].toSorted((a, b) => b.startedAt.localeCompare(a.startedAt));
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${esc(page.title)} status</title>
<link>${esc(link)}</link>
<description>Incidents on the ${esc(page.title)} status page</description>
<lastBuildDate>${new Date(page.updatedAt).toUTCString()}</lastBuildDate>
${incidents.map((i) => item(i, link)).join("\n")}
</channel>
</rss>`;
}

function item(i: PublicIncident, link: string): string {
  const state = i.resolvedAt ? `Resolved ${new Date(i.resolvedAt).toUTCString()}` : "Ongoing";
  const updates = i.updates.map((u) => `${u.status}: ${u.body}`).join("\n\n");
  return `<item>
<title>${esc(`${i.componentName}: ${i.kind === "slow" ? "slow responses" : i.title}`)}</title>
<link>${esc(link)}</link>
<guid isPermaLink="false">${esc(i.id)}</guid>
<pubDate>${new Date(i.startedAt).toUTCString()}</pubDate>
<description>${esc(`${state}.${updates ? `\n\n${updates}` : ""}`)}</description>
</item>`;
}
