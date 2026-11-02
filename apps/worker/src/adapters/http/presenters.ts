import type {
  ApiKey as ApiKeyDto,
  Channel as ChannelDto,
  Incident as IncidentDto,
  Maintenance as MaintenanceDto,
  Monitor as MonitorDto,
} from "@tiny-uptime/contracts";
import {
  channelTarget,
  isActive,
  isFinished,
  toInput,
  type ApiKey,
  type Channel,
  type IncidentListing,
  type MaintenanceWindow,
  type Monitor,
} from "@tiny-uptime/core";

/** Domain objects as the API shows them: ISO dates, flat settings, no secrets. */
export function presentMonitor(m: Monitor, origin: string): MonitorDto {
  const { state: s, heartbeatToken, createdAt, updatedAt, ...settings } = m;
  return {
    ...toInput(settings),
    id: m.id,
    status: s.status,
    lastCheckedAt: iso(s.lastCheckedAt),
    lastLatencyMs: s.lastLatencyMs,
    lastDetail: s.lastDetail,
    statusChangedAt: iso(s.statusChangedAt)!,
    nextCheckAt: iso(s.nextCheckAt),
    createdAt: iso(createdAt)!,
    updatedAt: iso(updatedAt)!,
    ...(heartbeatToken ? { heartbeatUrl: `${origin}/api/heartbeat/${heartbeatToken}` } : {}),
  };
}

/** A monitor's settings alone, as export files carry them: no state, and no channels, which belong to the workspace. */
export function presentSettings(m: Monitor): Record<string, unknown> {
  const { state: _state, heartbeatToken: _token, createdAt: _created, updatedAt: _updated, ...settings } = m;
  const { channelIds: _channels, ...input } = toInput(settings);
  return { ...input, id: m.id };
}

export function presentChannel(c: Channel): ChannelDto {
  return { id: c.id, type: c.type, name: c.name, enabled: c.enabled, ...channelTarget(c), createdAt: iso(c.createdAt)! };
}

export function presentApiKey(k: ApiKey): ApiKeyDto {
  return { id: k.id, name: k.name, hint: k.hint, createdAt: iso(k.createdAt)!, lastUsedAt: iso(k.lastUsedAt) };
}

export function presentIncident(i: IncidentListing): IncidentDto {
  return {
    id: i.id,
    monitorId: i.monitorId,
    monitorName: i.monitorName,
    kind: i.kind,
    startedAt: iso(i.startedAt)!,
    resolvedAt: iso(i.resolvedAt),
    cause: i.cause,
    acknowledgedAt: iso(i.acknowledgedAt),
    notified: i.notified,
  };
}

export function presentMaintenance(w: MaintenanceWindow, now = Date.now()): MaintenanceDto {
  return {
    id: w.id,
    name: w.name,
    monitorIds: w.monitorIds,
    startsAt: iso(w.startsAt)!,
    endsAt: iso(w.endsAt)!,
    recurrence: w.recurrence
      ? { frequency: w.recurrence.frequency, days: w.recurrence.days, timezone: w.recurrence.timezone, until: iso(w.recurrence.until) }
      : null,
    active: isActive(w, now),
    finished: isFinished(w, now),
    createdAt: iso(w.createdAt)!,
  };
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
