/**
 * A period when checks keep running but monitors open no incidents and send no alerts. It happens
 * once, or repeats daily or on chosen weekdays at the same local time in its time zone, across
 * daylight saving changes.
 */
export type MaintenanceWindow = {
  id: string;
  name: string;
  /** Monitors it covers; empty covers every monitor in the workspace. */
  monitorIds: string[];
  /** The first (or only) occurrence. For repeating windows it fixes the local start time and length. */
  startsAt: number;
  endsAt: number;
  recurrence: Recurrence | null;
  createdAt: number;
};

export type Recurrence = {
  frequency: "daily" | "weekly";
  /** For weekly windows: 0 is Sunday, 6 is Saturday, in the window's time zone. */
  days: number[];
  timezone: string;
  /** Last moment an occurrence may start; null repeats forever. */
  until: number | null;
};

const DAY = 86_400_000;

export function covers(window: MaintenanceWindow, monitorId: string): boolean {
  return window.monitorIds.length === 0 || window.monitorIds.includes(monitorId);
}

export function isActive(window: MaintenanceWindow, now: number): boolean {
  if (now < window.startsAt) return false;
  if (!window.recurrence) return now < window.endsAt;
  const { timezone, until } = window.recurrence;
  const length = window.endsAt - window.startsAt;
  const first = localParts(window.startsAt, timezone);
  const today = localParts(now, timezone);
  // An occurrence that started on an earlier local day may still be running.
  const lookBack = Math.ceil(length / DAY);
  for (let back = 0; back <= lookBack; back++) {
    const day = addDays(today, -back);
    if (!occursOn(window.recurrence, day)) continue;
    const start = zonedTime(day.year, day.month, day.day, first.hour, first.minute, timezone);
    if (start < window.startsAt || (until !== null && start > until)) continue;
    if (now >= start && now < start + length) return true;
  }
  return false;
}

/** Whether any window covering this monitor is active now. */
export function inMaintenance(windows: MaintenanceWindow[], monitorId: string, now: number): boolean {
  return windows.some((w) => covers(w, monitorId) && isActive(w, now));
}

/** Whether the window is over for good, so it can be shown as past. */
export function isFinished(window: MaintenanceWindow, now: number): boolean {
  if (!window.recurrence) return now >= window.endsAt;
  return window.recurrence.until !== null && now > window.recurrence.until + (window.endsAt - window.startsAt);
}

type LocalDate = { year: number; month: number; day: number; weekday: number };

function occursOn(recurrence: Recurrence, day: LocalDate): boolean {
  return recurrence.frequency === "daily" || recurrence.days.includes(day.weekday);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** The wall-clock date and time at `at` in a time zone. */
export function localParts(at: number, timezone: string): LocalDate & { hour: number; minute: number; second: number } {
  const parts = Object.fromEntries(
    formatter(timezone)
      .formatToParts(new Date(at))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return { ...parts, weekday };
}

/** The instant a wall-clock time happens in a time zone. A time skipped by DST resolves just after the gap. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timezone: string): number {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, timezone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const delta = wanted - shown;
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
}

function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}
