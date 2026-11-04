import type { MonitorInput, MonitorStatus, MonitorType, Region } from "@tiny-uptime/contracts";

export type HttpTarget = Pick<
  Extract<MonitorInput, { type: "http" }>,
  "url" | "method" | "headers" | "body" | "expectedStatus" | "keyword" | "jsonAssertions" | "timeoutMs"
>;
export type SocketTarget = { host: string; port: number; timeoutMs: number };
export type HeartbeatRule = { graceSec: number };
type ConfigOf<T extends MonitorType, K extends keyof Extract<MonitorInput, { type: T }>> = Pick<Extract<MonitorInput, { type: T }>, K>;
export type DnsTarget = ConfigOf<"dns", "host" | "recordType" | "expected" | "timeoutMs">;
export type WebSocketTarget = ConfigOf<"websocket", "url" | "headers" | "message" | "timeoutMs">;
export type DomainTarget = ConfigOf<"domain", "domain" | "warnDays" | "timeoutMs">;
/** A JSON-RPC endpoint over HTTP: MCP servers and blockchain nodes. */
export type RpcTarget = ConfigOf<"mcp", "url" | "headers" | "timeoutMs">;
export type EvmTarget = RpcTarget & ConfigOf<"evm", "chainId">;

/** What to check and how, by monitor type. */
export type MonitorSpec =
  | { type: "http"; config: HttpTarget }
  | { type: "tcp"; config: SocketTarget }
  | { type: "minecraft"; config: SocketTarget }
  | { type: "heartbeat"; config: HeartbeatRule }
  | { type: "dns"; config: DnsTarget }
  | { type: "postgres" | "mysql" | "redis"; config: SocketTarget }
  | { type: "websocket"; config: WebSocketTarget }
  | { type: "domain"; config: DomainTarget }
  | { type: "mcp" | "solana"; config: RpcTarget }
  | { type: "evm"; config: EvmTarget };

/** How a monitor judges its checks and whom it alerts, the same for every type. */
export type MonitorOptions = {
  failureThreshold: number;
  recoveryThreshold: number;
  slowThresholdMs: number | null;
  slowAlertAfter: number;
  tags: string[];
  dependsOn: string | null;
  channelIds: string[];
  /** Where checks run from; empty is wherever the workspace runs. */
  regions: Region[];
};

export const DEFAULT_OPTIONS: MonitorOptions = {
  failureThreshold: 2,
  recoveryThreshold: 1,
  slowThresholdMs: null,
  slowAlertAfter: 3,
  tags: [],
  dependsOn: null,
  channelIds: [],
  regions: [],
};

export type MonitorSettings = MonitorSpec & {
  name: string;
  intervalSec: number;
  paused: boolean;
  public: boolean;
  options: MonitorOptions;
};

/** Where a monitor stands, changed by checks, heartbeats and settings. */
export type MonitorState = {
  status: MonitorStatus;
  /** Failed checks in a row. */
  failures: number;
  /** Successful checks in a row, counted toward recovery. */
  successes: number;
  /** Slow checks in a row. */
  slowStreak: number;
  openIncidentId: string | null;
  openSlowIncidentId: string | null;
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
  const {
    type,
    name,
    intervalSec,
    paused,
    public: isPublic,
    failureThreshold,
    recoveryThreshold,
    slowThresholdMs,
    slowAlertAfter,
    tags,
    dependsOn,
    channelIds,
    regions,
    ...config
  } = input;
  const options: MonitorOptions = {
    failureThreshold,
    recoveryThreshold,
    slowThresholdMs,
    slowAlertAfter,
    tags,
    dependsOn,
    channelIds,
    regions,
  };
  return { type, name, intervalSec, paused, public: isPublic, options, config } as MonitorSettings;
}

/** The flat API shape of a monitor's settings, the inverse of toSettings. */
export function toInput(settings: MonitorSettings): MonitorInput {
  const { config, options, ...rest } = settings;
  return { ...rest, ...options, ...config } as MonitorInput;
}

/** What a monitor points at, as alerts and lists show it. */
export function targetOf(spec: MonitorSpec): string {
  switch (spec.type) {
    case "http":
      return spec.config.url;
    case "tcp":
    case "minecraft":
    case "postgres":
    case "mysql":
    case "redis":
      return `${spec.config.host}:${spec.config.port}`;
    case "heartbeat":
      return "";
    case "dns":
      return `${spec.config.recordType} ${spec.config.host}`;
    case "domain":
      return spec.config.domain;
    case "websocket":
    case "mcp":
    case "evm":
    case "solana":
      return spec.config.url;
  }
}

export function graceSecOf(spec: MonitorSpec): number {
  return spec.type === "heartbeat" ? spec.config.graceSec : 0;
}
