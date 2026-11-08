import { barQuery, type HistoryRange, type PublicStatusPage } from "@tiny-uptime/contracts";

/** The page at a range and zone; the page's default range in local time is the bare path. */
export function rangeHref(page: PublicStatusPage, path: string, days: HistoryRange, utc = page.utc): string {
  const query = [days === page.defaultHistoryDays ? "" : `days=${days}`, utc ? "tz=utc" : ""].filter(Boolean).join("&");
  return query ? `${path}?${query}` : path;
}

/** The page at its current range with one bar opened, scrolled to that bar's incidents. */
export function barHref(page: PublicStatusPage, path: string, day: string): string {
  const base = rangeHref(page, path, page.historyDays);
  return `${base}${base.includes("?") ? "&" : "?"}${barQuery(day)}#selected`;
}
