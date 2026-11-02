import type { Monitor, MonitorType } from "@tiny-uptime/contracts";

const LABELS: Record<MonitorType, string> = {
  http: "HTTP",
  tcp: "TCP",
  minecraft: "Minecraft",
  heartbeat: "Heartbeat",
  dns: "DNS",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  redis: "Redis",
  websocket: "WebSocket",
  domain: "Domain",
  mcp: "MCP",
  evm: "EVM",
  solana: "Solana",
};

export function typeLabel(type: MonitorType): string {
  return LABELS[type];
}

/** What a monitor points at, as one line. */
export function targetOf(m: Monitor): string {
  switch (m.type) {
    case "http":
    case "websocket":
    case "mcp":
    case "evm":
    case "solana":
      return m.url.replace(/^(https?|wss?):\/\//, "").replace(/\/$/, "");
    case "tcp":
    case "minecraft":
    case "postgres":
    case "mysql":
    case "redis":
      return `${m.host}:${m.port}`;
    case "heartbeat":
      return `every ${every(m.intervalSec)}`;
    case "dns":
      return `${m.recordType} ${m.host}`;
    case "domain":
      return `${m.domain}, warns ${m.warnDays} days ahead`;
  }
}

export function every(seconds: number): string {
  if (seconds % 3600 === 0) return seconds === 3600 ? "hour" : `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return seconds === 60 ? "minute" : `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}
