import * as v from "valibot";
import { SLUG } from "./admin";
import type { MonitorStatus } from "./monitor";

const id = v.pipe(v.string(), v.regex(/^[a-z2-7]{12}$/, "is not an id"));
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const pct = v.pipe(v.number(), v.minValue(0), v.maxValue(100));

export const STATUS_THEMES = ["auto", "light", "dark"] as const;

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

export type StatusPage = StatusPageInput & { id: string; url: string; createdAt: string };

/** One day on a public page's bars: its uptime, or null when nothing was checked. */
export type PublicDay = { day: string; uptime: number | null; checks: number };

export type PublicComponent = {
  id: string;
  name: string;
  status: MonitorStatus;
  /** Uptime across the days shown, or null without data. */
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
