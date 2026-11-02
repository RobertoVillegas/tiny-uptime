import type { Result } from "better-result";
import type { ApiKey } from "../domain/api-key";
import type { Channel, Delivery } from "../domain/channel";
import type { AlertEvent, Incident } from "../domain/incident";
import type { CheckOutcome } from "../domain/monitor/health";
import type { Monitor, MonitorSpec } from "../domain/monitor/monitor";
import type { DeliveryFailed } from "../errors";

export interface MonitorRepository {
  list(): Monitor[];
  listPublic(): Monitor[];
  get(id: string): Monitor | null;
  byHeartbeatToken(token: string): Monitor | null;
  /** Unpaused monitors whose next check is at or before `now`. */
  due(now: number): Monitor[];
  insert(monitor: Monitor): void;
  save(monitor: Monitor): void;
  delete(id: string): void;
}

export type IncidentListing = Incident & { monitorName: string | null };

export interface IncidentRepository {
  insert(incident: Incident): void;
  get(id: string): Incident | null;
  resolve(id: string, at: number): void;
  list(query: { limit: number; monitorId?: string }): IncidentListing[];
  deleteForMonitor(monitorId: string): void;
  purgeResolvedBefore(cutoff: number): void;
}

export type HourlyPoint = {
  hour: number;
  checks: number;
  ok: number;
  latencySum: number;
  latencyCount: number;
  latencyMin: number | null;
  latencyMax: number | null;
};

/** Check results folded into one row per monitor and hour. */
export interface HistoryRepository {
  record(monitorId: string, at: number, sample: { ok: boolean; latencyMs: number | null }): void;
  hourly(monitorId: string, since: number): HourlyPoint[];
  publicHourly(since: number): (HourlyPoint & { monitorId: string })[];
  deleteForMonitor(monitorId: string): void;
  purgeBefore(cutoff: number): void;
}

export interface ChannelRepository {
  list(): Channel[];
  enabled(): Channel[];
  get(id: string): Channel | null;
  insert(channel: Channel): void;
  save(channel: Channel): void;
  delete(id: string): void;
}

export interface DeliveryRepository {
  enqueue(delivery: Delivery): void;
  due(now: number): Delivery[];
  reschedule(id: string, attempts: number, nextAt: number, error: string): void;
  remove(id: string): void;
  removeForChannel(channelId: string): void;
}

export interface ApiKeyRepository {
  list(): ApiKey[];
  insert(key: ApiKey): void;
  delete(id: string): boolean;
  byHash(hash: string): ApiKey | null;
  touch(id: string, at: number): void;
}

export interface WorkspaceInfoRepository {
  /** Null until the workspace is initialized. */
  get(): { id: string; name: string } | null;
  init(id: string, name: string, now: number): void;
  lastCleanupAt(): number;
  setLastCleanupAt(at: number): void;
}

export interface Checker {
  check(spec: MonitorSpec): Promise<CheckOutcome>;
}

export interface Notifier {
  send(channel: Channel, event: AlertEvent): Promise<Result<void, DeliveryFailed>>;
}

/** Keeps the wake-up alarm on the earliest pending check or delivery. */
export interface Scheduler {
  sync(): Promise<void>;
}
