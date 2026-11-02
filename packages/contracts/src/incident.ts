export type Incident = {
  id: string;
  monitorId: string;
  monitorName: string | null;
  /** `down` is an outage; `slow` is a minor incident for slow responses. */
  kind: "down" | "slow";
  startedAt: string;
  resolvedAt: string | null;
  cause: string;
  acknowledgedAt: string | null;
  /** False when nobody was alerted: the monitor's dependency was down. */
  notified: boolean;
};

export const MAX_INCIDENTS_PAGE = 200;
