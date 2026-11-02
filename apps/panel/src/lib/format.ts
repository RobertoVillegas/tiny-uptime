const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Infinity],
];

/** "3 minutes ago", "in 20 seconds". */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  let value = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
    value /= size;
  }
  return relative.format(Math.round(value), "year");
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** 99.95% — two decimals, because the difference between 99.9 and 99.99 matters. */
export function percent(ratio: number | null): string {
  return ratio === null ? "—" : `${(ratio * 100).toFixed(2)}%`;
}

export function ms(value: number | null): string {
  return value === null ? "—" : `${value} ms`;
}

export function duration(fromIso: string, toIso: string | null, now = Date.now()): string {
  const seconds = Math.max(0, Math.round(((toIso ? new Date(toIso).getTime() : now) - new Date(fromIso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
