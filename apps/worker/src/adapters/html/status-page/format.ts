import type { PublicStatusPage } from "@tiny-uptime/contracts";

/** An uptime ratio as a percentage, rounded down so 99.999% never reads as 100.00%. */
export function pct(ratio: number | null): string {
  return ratio === null ? "—" : `${(Math.floor(ratio * 10_000) / 100).toFixed(2)}%`;
}

export type Formats = {
  zone: string;
  /** The page's zone label when days are cut in a zone other than the one times are shown in. */
  dayZone: string | null;
  date: (day: string) => string;
  hour: (iso: string) => string;
  dateTime: (iso: string) => string;
  time: (iso: string) => string;
};

/**
 * Dates and times in the page's language. A daily bar's date is already a local date in `dayZone`, so
 * it is shown as is; times of day are shown in `timeZone`, the visitor's when known.
 */
export function formats(page: PublicStatusPage, timeZone: string, dayZone: string): Formats {
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
  const pageZone = label(dayZone);
  return {
    zone,
    dayZone: pageZone === zone ? null : pageZone,
    date: (d) => day.format(new Date(`${d}T00:00:00Z`)),
    hour: (iso) => hour.format(new Date(iso)),
    dateTime: (iso) => hour.format(new Date(iso)),
    time: (iso) => time.format(new Date(iso)),
  };
}

/** How long an incident lasted, from a minute up. */
export function lasted(from: string, to: string): string {
  const minutes = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
