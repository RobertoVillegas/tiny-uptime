import type { HistoryRange, IncidentUpdateStatus, OverallStatus, STATUS_THEMES, StatusLanguage } from "@tiny-uptime/contracts";
import type { MonitorStatus } from "./monitor/monitor";

export type StatusPage = {
  id: string;
  slug: string;
  title: string;
  description: string;
  theme: (typeof STATUS_THEMES)[number];
  language: StatusLanguage;
  timeZone: string;
  historyDays: HistoryRange;
  incidentDays: HistoryRange;
  /** Start of the hour the history was reset at, or null. */
  historyResetAt: number | null;
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

/**
 * The banner of a status page, from the statuses of what it shows: maintenance wins while it is
 * on and nothing else is down; then outage size; slowness reads as degraded.
 */
/** `declared` are the kinds of open incidents people declared, which count even while monitors pass. */
export function overallStatus(statuses: MonitorStatus[], maintenanceActive: boolean, declared: ("down" | "slow")[] = []): OverallStatus {
  const down = statuses.filter((s) => s === "down").length;
  if (down > 0 && down === statuses.length) return "major_outage";
  if (down > 0 || declared.includes("down")) return "partial_outage";
  if (maintenanceActive) return "maintenance";
  if (statuses.some((s) => s === "degraded") || declared.includes("slow")) return "degraded";
  return "operational";
}
