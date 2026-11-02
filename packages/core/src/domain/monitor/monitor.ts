import type { MonitorInput, MonitorStatus, MonitorType } from "@tiny-uptime/contracts";

export type HttpTarget = Pick<
  Extract<MonitorInput, { type: "http" }>,
  "url" | "method" | "headers" | "body" | "expectedStatus" | "keyword" | "timeoutMs"
>;
export type SocketTarget = { host: string; port: number; timeoutMs: number };
export type HeartbeatRule = { graceSec: number };

/** What to check and how, by monitor type. */
export type MonitorSpec =
  | { type: "http"; config: HttpTarget }
  | { type: "tcp"; config: SocketTarget }
  | { type: "minecraft"; config: SocketTarget }
  | { type: "heartbeat"; config: HeartbeatRule };

export type MonitorSettings = MonitorSpec & { name: string; intervalSec: number; paused: boolean; public: boolean };

/** Where a monitor stands, changed by checks, heartbeats and settings. */
export type MonitorState = {
  status: MonitorStatus;
  /** Failed checks in a row. */
  failures: number;
  openIncidentId: string | null;
  nextCheckAt: number | null;
  lastCheckedAt: number | null;
  lastLatencyMs: number | null;
  lastDetail: string | null;
  statusChangedAt: number;
};

export type Monitor = MonitorSettings & {
  id: string;
  heartbeatToken: string | null;
  state: MonitorState;
  createdAt: number;
  updatedAt: number;
};

export type { MonitorStatus, MonitorType };

/** Splits the flat API shape into settings and type-specific config. */
export function toSettings(input: MonitorInput): MonitorSettings {
  const { type, name, intervalSec, paused, public: isPublic, ...config } = input;
  return { type, name, intervalSec, paused, public: isPublic, config } as MonitorSettings;
}

/** The flat API shape of a monitor's settings, the inverse of toSettings. */
export function toInput(settings: MonitorSettings): MonitorInput {
  const { config, ...rest } = settings;
  return { ...rest, ...config } as MonitorInput;
}

/** What a monitor points at, as alerts and lists show it. */
export function targetOf(spec: MonitorSpec): string {
  switch (spec.type) {
    case "http":
      return spec.config.url;
    case "tcp":
    case "minecraft":
      return `${spec.config.host}:${spec.config.port}`;
    case "heartbeat":
      return "";
  }
}

export function graceSecOf(spec: MonitorSpec): number {
  return spec.type === "heartbeat" ? spec.config.graceSec : 0;
}
