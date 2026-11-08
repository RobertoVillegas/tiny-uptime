import type { OverallStatus, StatusLanguage } from "@tiny-uptime/contracts";
import { esc } from "./escape";

const MESSAGE: Record<StatusLanguage, { label: string; unknown: string } & Record<OverallStatus, string>> = {
  en: {
    label: "status",
    unknown: "unknown",
    operational: "operational",
    degraded: "degraded",
    partial_outage: "partial outage",
    major_outage: "down",
    maintenance: "maintenance",
  },
  es: {
    label: "estado",
    unknown: "desconocido",
    operational: "operativo",
    degraded: "degradado",
    partial_outage: "falla parcial",
    major_outage: "caído",
    maintenance: "mantenimiento",
  },
};

/** Shields' palette, so the badge sits well next to the others in a README. */
const COLOR: Record<OverallStatus | "unknown", string> = {
  operational: "#4c1",
  degraded: "#dfb317",
  partial_outage: "#fe7d37",
  major_outage: "#e05d44",
  maintenance: "#007ec6",
  unknown: "#9f9f9f",
};

const MAX_LABEL = 40;

/**
 * A flat shields-style badge, "status | operational", in the page's language. `label` replaces
 * the left side; text is escaped and widths are estimated, since a Worker has no fonts to measure.
 */
export function renderStatusBadge(status: { language: StatusLanguage; overall: OverallStatus } | null, label: string | null): string {
  const words = MESSAGE[status?.language ?? "en"];
  const left = label?.trim().slice(0, MAX_LABEL) || words.label;
  const right = status ? words[status.overall] : words.unknown;
  const color = COLOR[status?.overall ?? "unknown"];
  const lw = Math.round(textWidth(left) + 12);
  const rw = Math.round(textWidth(right) + 12);
  const w = lw + rw;
  const title = esc(`${left}: ${right}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${title}"><title>${title}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">${text(left, lw / 2)}${text(right, lw + rw / 2)}</g></svg>`;
}

/** A line of text with shields' faint drop shadow. */
function text(s: string, x: number): string {
  return `<text x="${x}" y="15" fill="#010101" fill-opacity=".3">${esc(s)}</text><text x="${x}" y="14">${esc(s)}</text>`;
}

/** Roughly how wide `s` is in 11px Verdana, by classes of character width. */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if ("iljI.,:;!|'".includes(ch)) w += 3.2;
    else if ("ftr ()[]-".includes(ch)) w += 4.4;
    else if ("mwMW%@".includes(ch)) w += 10.2;
    else if (ch >= "A" && ch <= "Z") w += 7.6;
    else w += 6.8;
  }
  return w;
}
