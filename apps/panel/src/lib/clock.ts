/** How the panel shows times: the browser's habit, or a fixed 12- or 24-hour clock. Kept per browser. */
export const CLOCKS = [
  { value: "auto", label: "Browser default" },
  { value: "12", label: "12-hour (1:30 PM)" },
  { value: "24", label: "24-hour (13:30)" },
] as const;
export type Clock = (typeof CLOCKS)[number]["value"];

const KEY = "tiny-uptime.clock";

export function storedClock(): Clock {
  try {
    const stored = localStorage.getItem(KEY);
    return CLOCKS.some((c) => c.value === stored) ? (stored as Clock) : "auto";
  } catch {
    return "auto";
  }
}

export function storeClock(clock: Clock): void {
  try {
    localStorage.setItem(KEY, clock);
  } catch {
    // Private windows may refuse storage; times keep the browser's format.
  }
}

/** Options to merge into any time format so it follows the chosen clock. */
export function hourOptions(): Intl.DateTimeFormatOptions {
  const clock = storedClock();
  return clock === "auto" ? {} : { hourCycle: clock === "12" ? "h12" : "h23" };
}
