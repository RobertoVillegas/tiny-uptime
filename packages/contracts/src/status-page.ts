import * as v from "valibot";
import { SLUG } from "./admin";
import type { MonitorStatus } from "./monitor";

const id = v.pipe(v.string(), v.regex(/^[a-z2-7]{12}$/, "is not an id"));
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const pct = v.pipe(v.number(), v.minValue(0), v.maxValue(100));

export const STATUS_THEMES = ["auto", "light", "dark"] as const;
export const STATUS_LANGUAGES = ["en", "es"] as const;
export type StatusLanguage = (typeof STATUS_LANGUAGES)[number];
/** How far back a page's bars can reach, in days. One day is drawn hour by hour. */
export const HISTORY_RANGES = [1, 7, 14, 30, 45, 90] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];
/** The longest range, which is also how much daily history a page ever reads. */
export const MAX_HISTORY_DAYS = 90;

/** Whether this runtime knows the IANA zone, e.g. America/Mexico_City. */
export function isTimeZone(zone: string): boolean {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

const range = v.picklist(HISTORY_RANGES);

export const StatusPageComponentInput = v.object({
  monitorId: id,
  group: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60)), "Services"),
});

/** A public page listing chosen monitors, in groups, in the order given. */
export const StatusPageInput = v.pipe(
  v.object({
    title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
    slug: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.regex(SLUG, "must be lowercase letters, digits and dashes")),
    description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)), ""),
    theme: v.optional(v.picklist(STATUS_THEMES), "auto"),
    language: v.optional(v.picklist(STATUS_LANGUAGES), "en"),
    /** Where the page's dates and times are shown. Bars still split days at midnight UTC. */
    timeZone: v.optional(v.pipe(v.string(), v.trim(), v.check(isTimeZone, "must be a time zone like America/Mexico_City")), "UTC"),
    /** The range the bars show until a visitor picks another. */
    historyDays: v.optional(range, 90),
    /** How far back the list of past incidents goes. */
    incidentDays: v.optional(range, 14),
    showLatency: v.optional(v.boolean(), true),
    /** A link back to the product the page reports on. */
    externalUrl: v.optional(
      v.nullable(v.pipe(v.string(), v.trim(), v.url("must be a URL"), v.regex(/^https?:\/\//i, "must be an http or https URL"))),
      null,
    ),
    hideBranding: v.optional(v.boolean(), false),
    /** Bars are green at or above this uptime, amber at or above warnPct, red below. */
    okPct: v.optional(pct, 99.9),
    warnPct: v.optional(pct, 98),
    /** A hostname pointed at this Worker that serves the page at its root. */
    customDomain: v.optional(
      v.nullable(v.pipe(v.string(), v.trim(), v.toLowerCase(), v.regex(HOSTNAME, "must be a hostname like status.example.com"))),
      null,
    ),
    components: v.optional(v.pipe(v.array(StatusPageComponentInput), v.maxLength(100)), []),
  }),
  v.forward(
    v.check((p) => p.warnPct <= p.okPct, "must be at most the green threshold"),
    ["warnPct"],
  ),
);
export type StatusPageInput = v.InferOutput<typeof StatusPageInput>;
export type StatusPageDraft = v.InferInput<typeof StatusPageInput>;

export type StatusPage = StatusPageInput & {
  id: string;
  url: string;
  /** When the page's history was last reset: nothing before it is shown. */
  historyResetAt: string | null;
  createdAt: string;
};

/**
 * One bar on a public page: a day (`2026-11-03`), or an hour (`2026-11-03T14:00:00.000Z`) when
 * the page shows a single day. Uptime is null when nothing was checked.
 */
export type PublicDay = { day: string; uptime: number | null; checks: number };

export type PublicComponent = {
  id: string;
  name: string;
  status: MonitorStatus;
  /** Uptime across the bars shown, or null without data. */
  uptime: number | null;
  latencyMs: number | null;
  days: PublicDay[];
};

export type PublicIncidentUpdate = { status: IncidentUpdateStatus; body: string; createdAt: string };

export type PublicIncident = {
  id: string;
  title: string;
  componentName: string;
  kind: "down" | "slow";
  startedAt: string;
  resolvedAt: string | null;
  updates: PublicIncidentUpdate[];
};

export type PublicMaintenance = { name: string; startsAt: string; endsAt: string; active: boolean; componentNames: string[] };

export type OverallStatus = "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance";

export type PublicStatusPage = {
  title: string;
  description: string;
  theme: (typeof STATUS_THEMES)[number];
  language: StatusLanguage;
  timeZone: string;
  /** The range these bars cover, and the one the page opens with. */
  historyDays: HistoryRange;
  defaultHistoryDays: HistoryRange;
  /** "hour" when the range is one day. */
  barSize: "day" | "hour";
  incidentDays: HistoryRange;
  historyResetAt: string | null;
  showLatency: boolean;
  externalUrl: string | null;
  hideBranding: boolean;
  okPct: number;
  warnPct: number;
  overall: OverallStatus;
  groups: { name: string; components: PublicComponent[] }[];
  activeIncidents: PublicIncident[];
  pastIncidents: PublicIncident[];
  maintenance: PublicMaintenance[];
  updatedAt: string;
};

export const INCIDENT_UPDATE_STATUSES = ["investigating", "identified", "monitoring", "resolved", "update"] as const;
export type IncidentUpdateStatus = (typeof INCIDENT_UPDATE_STATUSES)[number];

/** A note on an incident: public ones appear on status pages and feeds, internal ones only in the panel. */
export const IncidentUpdateInput = v.object({
  status: v.optional(v.picklist(INCIDENT_UPDATE_STATUSES), "update"),
  body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2000)),
  visibility: v.optional(v.picklist(["public", "internal"]), "public"),
});
export type IncidentUpdateInput = v.InferOutput<typeof IncidentUpdateInput>;

export type IncidentUpdate = IncidentUpdateInput & { id: string; incidentId: string; author: string | null; createdAt: string };
