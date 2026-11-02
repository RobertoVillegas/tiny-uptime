import type { MonitorStatus } from "./monitor";

export type PublicMonitor = {
  id: string;
  name: string;
  status: MonitorStatus;
  lastMs: number | null;
  uptime24h: number | null;
  hours: { hour: number; checks: number; ok: number }[];
};

export type PublicStatus = { name: string; monitors: PublicMonitor[] };
