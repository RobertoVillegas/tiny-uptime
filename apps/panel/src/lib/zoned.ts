/** Converts between `datetime-local` input values and instants, in a given IANA time zone. */

export const browserTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const timezones = (): string[] => {
  const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return list.includes("UTC") ? list : ["UTC", ...list];
};

function parts(at: number, timezone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(at))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return values as Record<"year" | "month" | "day" | "hour" | "minute", string>;
}

/** "2026-11-08T02:00" in America/Mexico_City → ISO instant. */
export function localToIso(local: string, timezone: string): string {
  const [date, time = "00:00"] = local.split("T");
  const [y, m, d] = date!.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wanted = Date.UTC(y!, m! - 1, d!, h!, min!);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = parts(guess, timezone);
    const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    if (shown === wanted) break;
    guess += wanted - shown;
  }
  return new Date(guess).toISOString();
}

/** ISO instant → "2026-11-08T02:00" as seen in a time zone. */
export function isoToLocal(iso: string, timezone: string): string {
  const p = parts(new Date(iso).getTime(), timezone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
