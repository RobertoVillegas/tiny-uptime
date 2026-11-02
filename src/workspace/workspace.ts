import { DurableObject } from "cloudflare:workers";
import { deliver, type AlertPayload, type ChannelFields } from "../channels";
import { newId, sha256Hex } from "../lib/ids";
import { checkHttp, checkMinecraft, checkTcp, type CheckResult } from "../monitors/checks";
import type { MonitorFields } from "../monitors/model";
import type { Env } from "../env";
import { handleApi, type ApiRequest, type ApiResponse } from "./api";
import { MIGRATIONS } from "./schema";

export type Status = "pending" | "up" | "down" | "paused";

export type MonitorRow = {
  id: string;
  name: string;
  type: MonitorFields["type"];
  config: string;
  interval_sec: number;
  paused: number;
  public: number;
  heartbeat_token: string | null;
  status: Status;
  failures: number;
  open_incident: string | null;
  next_at: number | null;
  last_at: number | null;
  last_ms: number | null;
  last_detail: string | null;
  changed_at: number;
  created_at: number;
  updated_at: number;
};

export type PublicMonitor = {
  id: string;
  name: string;
  status: Status;
  lastMs: number | null;
  uptime24h: number | null;
  hours: { hour: number; checks: number; ok: number }[];
};

/** Failures in a row before a monitor is reported down, and how soon a failed check is retried. */
const DOWN_AFTER = 2;
const RETRY_MS = 20_000;
const CONCURRENCY = 6;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RETENTION_MS = 400 * DAY;
/** Delays before each retry of a failed alert delivery; it is dropped after the last one. */
const DELIVERY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
/** How often an API key's last use is written, to keep reads from costing writes. */
const KEY_TOUCH_MS = HOUR;

export class Workspace extends DurableObject<Env> {
  readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      if (this.initialized()) this.migrate();
    });
  }

  /** Creates the workspace's database. A workspace that was never initialized answers nothing, so guessed ids cost no storage. */
  async init(id: string, name: string): Promise<void> {
    if (this.initialized()) return;
    this.migrate();
    const now = Date.now();
    this.sql.exec("INSERT INTO meta (key, value) VALUES ('id', ?), ('name', ?), ('created_at', ?)", id, name, String(now));
  }

  /** Answers with the body already serialized, so the response crosses the RPC boundary as one string. */
  async api(request: ApiRequest): Promise<{ status: number; json: string | null }> {
    const unauthorized = { status: 401, json: JSON.stringify({ error: "invalid API key" }) };
    if (!this.initialized()) return unauthorized;
    if (!this.authenticate(request.keyHash, Date.now())) return unauthorized;
    const res: ApiResponse = await handleApi(this, request);
    return { status: res.status, json: res.body === null ? null : JSON.stringify(res.body) };
  }

  async createApiKey(name: string, plaintext: string): Promise<{ id: string; name: string; hint: string }> {
    const id = newId();
    const hint = `…${plaintext.slice(-4)}`;
    this.sql.exec(
      "INSERT INTO api_key (id, name, hash, hint, created_at) VALUES (?, ?, ?, ?, ?)",
      id, name, await sha256Hex(plaintext), hint, Date.now(),
    );
    return { id, name, hint };
  }

  async heartbeat(token: string): Promise<boolean> {
    if (!this.initialized()) return false;
    const monitor = this.sql
      .exec<MonitorRow>("SELECT * FROM monitor WHERE heartbeat_token = ? AND type = 'heartbeat'", token)
      .toArray()[0];
    if (!monitor) return false;
    if (monitor.paused) return true;
    const now = Date.now();
    const deadline = now + (monitor.interval_sec + graceOf(monitor)) * 1000;
    this.sql.exec(
      "UPDATE monitor SET last_at = ?, next_at = ?, last_detail = 'heartbeat received', failures = 0 WHERE id = ?",
      now, deadline, monitor.id,
    );
    this.rollup(monitor.id, now, true, null);
    await this.transition(monitor, "up", now, "heartbeat received");
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > deadline) await this.ctx.storage.setAlarm(deadline);
    return true;
  }

  async snapshot(): Promise<{ name: string; monitors: PublicMonitor[] } | null> {
    if (!this.initialized()) return null;
    const since = Math.floor(Date.now() / HOUR) * HOUR - 23 * HOUR;
    const hours = this.sql
      .exec<{ monitor_id: string; hour: number; checks: number; ok: number }>(
        "SELECT r.monitor_id, r.hour, r.checks, r.ok FROM rollup r JOIN monitor m ON m.id = r.monitor_id WHERE m.public = 1 AND r.hour >= ? ORDER BY r.hour",
        since,
      )
      .toArray();
    const monitors = this.sql
      .exec<MonitorRow>("SELECT * FROM monitor WHERE public = 1 ORDER BY name")
      .toArray()
      .map((m) => {
        const mine = hours.filter((h) => h.monitor_id === m.id);
        const checks = mine.reduce((n, h) => n + h.checks, 0);
        const ok = mine.reduce((n, h) => n + h.ok, 0);
        return {
          id: m.id,
          name: m.name,
          status: m.status,
          lastMs: m.last_ms,
          uptime24h: checks ? ok / checks : null,
          hours: mine.map(({ hour, checks, ok }) => ({ hour, checks, ok })),
        };
      });
    return { name: this.meta("name") ?? "Status", monitors };
  }

  override async alarm(): Promise<void> {
    if (!this.initialized()) return;
    const now = Date.now();
    const due = this.sql
      .exec<MonitorRow>("SELECT * FROM monitor WHERE paused = 0 AND next_at IS NOT NULL AND next_at <= ? ORDER BY next_at", now)
      .toArray();
    const checks = due.filter((m) => m.type !== "heartbeat");
    for (let i = 0; i < checks.length; i += CONCURRENCY) {
      const batch = checks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((m) => runCheck(m)));
      // Other requests run while a check waits on the network: a monitor may have been paused,
      // edited or deleted meanwhile. Only a result for the monitor as it still is gets recorded.
      for (const [index, before] of batch.entries()) {
        const monitor = this.monitor(before.id);
        if (!monitor || monitor.paused || monitor.updated_at !== before.updated_at) continue;
        await this.recordCheck(monitor, results[index]!, now);
      }
    }
    for (const before of due.filter((m) => m.type === "heartbeat")) {
      const monitor = this.monitor(before.id);
      if (monitor && !monitor.paused && monitor.next_at !== null && monitor.next_at <= now) await this.recordMissedHeartbeat(monitor, now);
    }
    await this.retryDeliveries(now);
    this.cleanup(now);
    await this.schedule();
  }

  // ---- used by the API handler ----

  meta(key: string): string | undefined {
    return this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value;
  }

  monitor(id: string): MonitorRow | undefined {
    return this.sql.exec<MonitorRow>("SELECT * FROM monitor WHERE id = ?", id).toArray()[0];
  }

  async schedule(): Promise<void> {
    const next = this.sql
      .exec<{ at: number | null }>(
        "SELECT min(at) AS at FROM (SELECT min(next_at) AS at FROM monitor WHERE paused = 0 UNION ALL SELECT min(next_at) FROM delivery)",
      )
      .toArray()[0]?.at;
    const current = await this.ctx.storage.getAlarm();
    if (next == null) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
    } else if (current !== next) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  /** Closes a monitor's open incident without alerting: used when it is paused or deleted. */
  closeIncidentQuietly(monitor: MonitorRow, now: number): void {
    if (monitor.open_incident) this.sql.exec("UPDATE incident SET resolved_at = ? WHERE id = ?", now, monitor.open_incident);
  }

  async sendTest(channel: ChannelFields): Promise<void> {
    const now = new Date().toISOString();
    await deliver(channel, {
      kind: "incident.opened",
      incident: { id: `test-${newId(6)}`, title: "Test alert", startedAt: now, resolvedAt: null },
      monitor: { name: "tiny-uptime test", target: "" },
      test: true,
    });
  }

  // ---- internals ----

  private initialized(): boolean {
    return this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length > 0;
  }

  private migrate(): void {
    const hasMeta = this.initialized();
    const applied = hasMeta ? Number(this.meta("schema") ?? "0") : 0;
    for (let version = applied; version < MIGRATIONS.length; version++) {
      this.sql.exec(MIGRATIONS[version]!);
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)", String(version + 1));
    }
  }

  private authenticate(keyHash: string, now: number): string | null {
    const key = this.sql
      .exec<{ id: string; last_used_at: number | null }>("SELECT id, last_used_at FROM api_key WHERE hash = ?", keyHash)
      .toArray()[0];
    if (!key) return null;
    if (key.last_used_at === null || now - key.last_used_at > KEY_TOUCH_MS) {
      this.sql.exec("UPDATE api_key SET last_used_at = ? WHERE id = ?", now, key.id);
    }
    return key.id;
  }

  private async recordCheck(monitor: MonitorRow, result: CheckResult, now: number): Promise<void> {
    const failures = result.ok ? 0 : monitor.failures + 1;
    const confirmedDown = failures >= DOWN_AFTER;
    const next = !result.ok && !confirmedDown ? now + RETRY_MS : nextSlot(monitor.id, monitor.interval_sec, now);
    this.sql.exec(
      "UPDATE monitor SET failures = ?, next_at = ?, last_at = ?, last_ms = ?, last_detail = ? WHERE id = ?",
      failures, next, now, result.ms, result.detail, monitor.id,
    );
    this.rollup(monitor.id, now, result.ok, result.ms);
    if (result.ok) await this.transition(monitor, "up", now, result.detail);
    else if (confirmedDown) await this.transition(monitor, "down", now, result.detail);
  }

  private async recordMissedHeartbeat(monitor: MonitorRow, now: number): Promise<void> {
    this.sql.exec("UPDATE monitor SET next_at = NULL, last_detail = 'no heartbeat received' WHERE id = ?", monitor.id);
    this.rollup(monitor.id, now, false, null);
    await this.transition(monitor, "down", now, "no heartbeat received");
  }

  private rollup(monitorId: string, at: number, ok: boolean, ms: number | null): void {
    this.sql.exec(
      `INSERT INTO rollup (monitor_id, hour, checks, ok, ms_sum, ms_count) VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT (monitor_id, hour) DO UPDATE SET checks = checks + 1, ok = ok + excluded.ok,
         ms_sum = ms_sum + excluded.ms_sum, ms_count = ms_count + excluded.ms_count`,
      monitorId, Math.floor(at / HOUR) * HOUR, ok ? 1 : 0, ms ?? 0, ms === null ? 0 : 1,
    );
  }

  private async transition(monitor: MonitorRow, status: "up" | "down", now: number, detail: string): Promise<void> {
    if (monitor.status === status) return;
    if (status === "down") {
      const incident = newId();
      this.sql.exec("INSERT INTO incident (id, monitor_id, started_at, cause) VALUES (?, ?, ?, ?)", incident, monitor.id, now, detail);
      this.sql.exec("UPDATE monitor SET status = 'down', changed_at = ?, open_incident = ? WHERE id = ?", now, incident, monitor.id);
      await this.alert({
        kind: "incident.opened",
        incident: { id: incident, title: detail, startedAt: new Date(now).toISOString(), resolvedAt: null },
        monitor: { name: monitor.name, target: targetOf(monitor) },
      });
      return;
    }
    this.sql.exec("UPDATE monitor SET status = 'up', changed_at = ?, open_incident = NULL WHERE id = ?", now, monitor.id);
    if (!monitor.open_incident) return;
    this.sql.exec("UPDATE incident SET resolved_at = ? WHERE id = ?", now, monitor.open_incident);
    const startedAt = this.sql.exec<{ started_at: number }>("SELECT started_at FROM incident WHERE id = ?", monitor.open_incident).toArray()[0]?.started_at ?? now;
    await this.alert({
      kind: "incident.resolved",
      incident: { id: monitor.open_incident, title: `${monitor.name} recovered`, startedAt: new Date(startedAt).toISOString(), resolvedAt: new Date(now).toISOString() },
      monitor: { name: monitor.name, target: targetOf(monitor) },
    });
  }

  /** Tries every enabled channel now; a failed delivery is queued and retried from the alarm. */
  private async alert(payload: AlertPayload): Promise<void> {
    const channels = this.sql
      .exec<{ id: string; type: "webhook"; name: string; config: string }>("SELECT id, type, name, config FROM channel WHERE enabled = 1")
      .toArray();
    await Promise.all(
      channels.map(async (row) => {
        const channel: ChannelFields = { type: row.type, name: row.name, enabled: true, config: JSON.parse(row.config) };
        try {
          await deliver(channel, payload);
        } catch (error) {
          console.warn("alert delivery failed, will retry", row.id, errorText(error));
          this.sql.exec(
            "INSERT INTO delivery (id, channel_id, payload, attempts, next_at, last_error) VALUES (?, ?, ?, 1, ?, ?)",
            newId(), row.id, JSON.stringify(payload), Date.now() + DELIVERY_BACKOFF_MS[0]!, errorText(error),
          );
        }
      }),
    );
  }

  private async retryDeliveries(now: number): Promise<void> {
    const due = this.sql
      .exec<{ id: string; channel_id: string; payload: string; attempts: number; type: "webhook"; name: string; config: string; enabled: number }>(
        `SELECT d.id, d.channel_id, d.payload, d.attempts, c.type, c.name, c.config, c.enabled
         FROM delivery d JOIN channel c ON c.id = d.channel_id WHERE d.next_at <= ?`,
        now,
      )
      .toArray();
    for (const row of due) {
      if (!row.enabled) {
        this.sql.exec("DELETE FROM delivery WHERE id = ?", row.id);
        continue;
      }
      try {
        await deliver({ type: row.type, name: row.name, enabled: true, config: JSON.parse(row.config) }, JSON.parse(row.payload));
        this.sql.exec("DELETE FROM delivery WHERE id = ?", row.id);
      } catch (error) {
        const delay = DELIVERY_BACKOFF_MS[row.attempts];
        if (delay === undefined) {
          console.error("alert delivery dropped after retries", row.channel_id, errorText(error));
          this.sql.exec("DELETE FROM delivery WHERE id = ?", row.id);
        } else {
          this.sql.exec(
            "UPDATE delivery SET attempts = attempts + 1, next_at = ?, last_error = ? WHERE id = ?",
            now + delay, errorText(error), row.id,
          );
        }
      }
    }
    // Deliveries whose channel was deleted.
    this.sql.exec("DELETE FROM delivery WHERE channel_id NOT IN (SELECT id FROM channel)");
  }

  /** Once a day, drops history older than the retention window. */
  private cleanup(now: number): void {
    const last = Number(this.meta("cleanup_at") ?? "0");
    if (now - last < DAY) return;
    const cutoff = now - RETENTION_MS;
    this.sql.exec("DELETE FROM rollup WHERE hour < ?", cutoff);
    this.sql.exec("DELETE FROM incident WHERE resolved_at IS NOT NULL AND resolved_at < ?", cutoff);
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('cleanup_at', ?)", String(now));
  }
}

function runCheck(monitor: MonitorRow): Promise<CheckResult> {
  const config = JSON.parse(monitor.config);
  if (monitor.type === "http") return checkHttp(config);
  if (monitor.type === "minecraft") return checkMinecraft(config);
  return checkTcp(config);
}

export function graceOf(monitor: Pick<MonitorRow, "type" | "config">): number {
  return monitor.type === "heartbeat" ? (JSON.parse(monitor.config) as { graceSec: number }).graceSec : 0;
}

export function targetOf(monitor: Pick<MonitorRow, "type" | "config">): string {
  const config = JSON.parse(monitor.config) as { url?: string; host?: string; port?: number };
  if (monitor.type === "http") return config.url ?? "";
  if (monitor.type === "heartbeat") return "";
  return `${config.host}:${config.port}`;
}

/** Each monitor checks at a fixed offset inside its interval, so monitors spread out instead of firing together. */
export function nextSlot(id: string, intervalSec: number, now: number): number {
  const interval = intervalSec * 1000;
  const phase = (fnv1a(id) % intervalSec) * 1000;
  return Math.floor((now - phase) / interval) * interval + interval + phase;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
