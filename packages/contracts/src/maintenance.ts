import * as v from "valibot";

const id = v.pipe(v.string(), v.regex(/^[a-z2-7]{12}$/, "is not an id"));
const isoDate = v.pipe(v.string(), v.isoTimestamp("must be an ISO 8601 date and time"));
const MAX_LENGTH_MS = 7 * 24 * 3_600_000;

/** Whether the runtime knows this IANA time zone, like America/Mexico_City. */
export function isValidTimezone(timezone: string): boolean {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

const Recurrence = v.object({
  frequency: v.picklist(["daily", "weekly"]),
  /** 0 is Sunday. Required for weekly windows. */
  days: v.optional(v.pipe(v.array(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(6))), v.maxLength(7)), []),
  timezone: v.pipe(v.string(), v.check(isValidTimezone, "must be an IANA time zone, like America/Mexico_City")),
  until: v.optional(v.nullable(isoDate), null),
});

/** A period when monitors keep checking but open no incidents and send no alerts. */
export const MaintenanceInput = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
    monitorIds: v.optional(v.pipe(v.array(id), v.maxLength(200)), []),
    startsAt: isoDate,
    endsAt: isoDate,
    recurrence: v.optional(v.nullable(Recurrence), null),
  }),
  v.forward(
    v.check((w) => new Date(w.endsAt).getTime() > new Date(w.startsAt).getTime(), "must be after the start"),
    ["endsAt"],
  ),
  v.forward(
    v.check(
      (w) => new Date(w.endsAt).getTime() - new Date(w.startsAt).getTime() <= MAX_LENGTH_MS,
      "must be at most 7 days after the start",
    ),
    ["endsAt"],
  ),
  v.forward(
    v.check((w) => w.recurrence?.frequency !== "weekly" || (w.recurrence.days?.length ?? 0) > 0, "must name at least one weekday"),
    ["recurrence", "days"],
  ),
  v.forward(
    v.check(
      (w) => w.recurrence?.frequency !== "daily" || new Date(w.endsAt).getTime() - new Date(w.startsAt).getTime() <= 24 * 3_600_000,
      "a daily window must last at most 24 hours",
    ),
    ["endsAt"],
  ),
);
export type MaintenanceInput = v.InferOutput<typeof MaintenanceInput>;
export type MaintenanceDraft = v.InferInput<typeof MaintenanceInput>;

export type Maintenance = MaintenanceInput & {
  id: string;
  /** Whether it covers its monitors right now. */
  active: boolean;
  /** One-off windows that ended, and repeating ones past their until date. */
  finished: boolean;
  createdAt: string;
};
