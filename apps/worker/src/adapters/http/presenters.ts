import type { ApiKey as ApiKeyDto, Channel as ChannelDto, Incident as IncidentDto, Monitor as MonitorDto } from "@tiny-uptime/contracts";
import { toInput, type ApiKey, type Channel, type IncidentListing, type Monitor } from "@tiny-uptime/core";

/** Domain objects as the API shows them: ISO dates, flat settings, no secrets. */
export function presentMonitor(m: Monitor, origin: string): MonitorDto {
  const s = m.state;
  return {
    id: m.id,
    ...toInput(m),
    status: s.status,
    lastCheckedAt: iso(s.lastCheckedAt),
    lastLatencyMs: s.lastLatencyMs,
    lastDetail: s.lastDetail,
    statusChangedAt: iso(s.statusChangedAt)!,
    nextCheckAt: iso(s.nextCheckAt),
    createdAt: iso(m.createdAt)!,
    updatedAt: iso(m.updatedAt)!,
    ...(m.heartbeatToken ? { heartbeatUrl: `${origin}/api/heartbeat/${m.heartbeatToken}` } : {}),
  };
}

export function presentChannel(c: Channel): ChannelDto {
  return { id: c.id, type: c.type, name: c.name, enabled: c.enabled, host: new URL(c.url).host, createdAt: iso(c.createdAt)! };
}

export function presentApiKey(k: ApiKey): ApiKeyDto {
  return { id: k.id, name: k.name, hint: k.hint, createdAt: iso(k.createdAt)!, lastUsedAt: iso(k.lastUsedAt) };
}

export function presentIncident(i: IncidentListing): IncidentDto {
  return {
    id: i.id,
    monitorId: i.monitorId,
    monitorName: i.monitorName,
    startedAt: iso(i.startedAt)!,
    resolvedAt: iso(i.resolvedAt),
    cause: i.cause,
  };
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
