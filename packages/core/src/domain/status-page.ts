import type { IncidentUpdateStatus, OverallStatus, STATUS_THEMES } from "@tiny-uptime/contracts";
import type { MonitorStatus } from "./monitor/monitor";

export type StatusPage = {
  id: string;
  slug: string;
  title: string;
  description: string;
  theme: (typeof STATUS_THEMES)[number];
  showLatency: boolean;
  externalUrl: string | null;
  hideBranding: boolean;
  okPct: number;
  warnPct: number;
  customDomain: string | null;
  createdAt: number;
};

export type StatusComponent = { pageId: string; monitorId: string; group: string; position: number };

export type IncidentUpdate = {
  id: string;
  incidentId: string;
  status: IncidentUpdateStatus;
  body: string;
  visibility: "public" | "internal";
  author: string | null;
  createdAt: number;
};

/** Days of history a public page shows. */
export const PUBLIC_DAYS = 90;
/** Resolved incidents a public page lists. */
export const PUBLIC_INCIDENT_DAYS = 14;

/**
 * The banner of a status page, from the statuses of what it shows: maintenance wins while it is
 * on and nothing else is down; then outage size; slowness reads as degraded.
 */
export function overallStatus(statuses: MonitorStatus[], maintenanceActive: boolean): OverallStatus {
  const down = statuses.filter((s) => s === "down").length;
  if (down > 0 && down === statuses.length) return "major_outage";
  if (down > 0) return "partial_outage";
  if (maintenanceActive) return "maintenance";
  if (statuses.some((s) => s === "degraded")) return "degraded";
  return "operational";
}
