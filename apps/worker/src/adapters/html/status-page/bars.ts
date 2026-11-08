import type { PublicDay, PublicStatusPage } from "@tiny-uptime/contracts";
import { esc } from "../escape";
import { pct, type Formats } from "./format";
import { barHref } from "./links";
import type { Text } from "./text";

/** How far back `bars` bars of `size` reach, in days once that is two days or more. */
export function span(bars: number, size: "day" | "hour"): [number, "day" | "hour"] {
  return size === "hour" && bars >= 48 ? [bars / 24, "day"] : [bars, size];
}

/** Down or degraded by uptime first; a bar that stayed up but answered slowly is degraded too. */
export function tone(d: PublicDay, page: PublicStatusPage): string {
  if (d.uptime === null) return "none";
  if (d.uptime * 100 < page.warnPct) return "down";
  return d.uptime * 100 < page.okPct || d.slow ? "warn" : "up";
}

export function barLabel(d: PublicDay, t: Text): string {
  if (d.uptime === null) return t.noData;
  return [t.checks(pct(d.uptime), d.checks), ...barNotes(d, t)].join(". ");
}

/** The average response time, or that it was slow when the page hides latency. */
function barNotes(d: PublicDay, t: Text): string[] {
  if (d.ms !== null) return [d.slow ? `${t.avgMs(d.ms)} (${t.slowShort})` : t.avgMs(d.ms)];
  return d.slow ? [t.slowShort] : [];
}

export function barTip(d: PublicDay, when: string, t: Text): string {
  const body =
    d.uptime === null
      ? t.noData
      : t.checks(pct(d.uptime), d.checks) +
        barNotes(d, t)
          .map((n) => `<span>${n}</span>`)
          .join("");
  return `<span class="tip" aria-hidden="true"><b>${when}</b>${body}</span>`;
}

export function barWhen(day: string, page: PublicStatusPage, f: Formats): string {
  return page.barSize === "hour" ? f.hour(day) : f.date(day);
}

/** A link that opens the bar; the tooltip shows pointer users what its accessible name says. */
export function bar(d: PublicDay, page: PublicStatusPage, path: string, t: Text, f: Formats): string {
  const label = barLabel(d, t);
  const when = barWhen(d.day, page, f);
  const current = page.selected?.bar === d.day ? ` aria-current="${page.barSize === "hour" ? "time" : "date"}"` : "";
  return `<a class="bar ${tone(d, page)}" href="${esc(barHref(page, path, d.day))}" aria-label="${esc(`${when}: ${label}. ${t.openBar}`)}"${current}>${barTip(d, when, t)}</a>`;
}

/** One hour of an opened day: not a link, but focusable so keyboard users get its tooltip too. */
export function hourBar(h: PublicDay, page: PublicStatusPage, t: Text, f: Formats): string {
  const when = f.time(h.day);
  return `<span class="bar ${tone(h, page)}" role="img" tabindex="0" aria-label="${esc(`${when}: ${barLabel(h, t)}`)}">${barTip(h, when, t)}</span>`;
}
