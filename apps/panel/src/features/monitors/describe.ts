import type { Monitor, MonitorType } from "@tiny-uptime/contracts";

const LABELS: Record<MonitorType, string> = { http: "HTTP", tcp: "TCP", minecraft: "Minecraft", heartbeat: "Heartbeat" };

export function typeLabel(type: MonitorType): string {
  return LABELS[type];
}

/** What a monitor points at, as one line. */
export function targetOf(m: Monitor): string {
  switch (m.type) {
    case "http":
      return m.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    case "tcp":
    case "minecraft":
      return `${m.host}:${m.port}`;
    case "heartbeat":
      return `every ${every(m.intervalSec)}`;
  }
}

export function every(seconds: number): string {
  if (seconds % 3600 === 0) return seconds === 3600 ? "hour" : `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return seconds === 60 ? "minute" : `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}
