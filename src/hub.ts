import { DurableObject } from "cloudflare:workers";
import { checkHttp, checkMinecraft, type CheckResult } from "./checks";
import { MONITORS, type MonitorConfig } from "./monitors";

export interface Env {
  HUB: DurableObjectNamespace<Hub>;
  ADMIN_TOKEN?: string;
  ALERT_WEBHOOK_URL?: string;
}

type Status = "pending" | "up" | "down";

type MonitorRow = {
  id: string;
  name: string;
  kind: MonitorConfig["kind"];
  target: string | null;
  interval_sec: number;
  timeout_ms: number;
  grace_sec: number;
  token: string | null;
  status: Status;
  failures: number;
  next_at: number | null;
  last_at: number | null;
  last_ms: number | null;
  last_detail: string | null;
  changed_at: number;
};

export type PublicMonitor = {
  id: string;
  name: string;
  kind: MonitorConfig["kind"];
  status: Status;
  lastAt: number | null;
  lastMs: number | null;
  detail: string | null;
  since: number;
  uptime24h: number | null;
  hours: { hour: number; checks: number; ok: number }[];
};

// Failures in a row before a monitor is reported down, and how soon a failed check is retried.
const DOWN_AFTER = 2;
const RETRY_MS = 20_000;
const CONCURRENCY = 6;
const HOUR = 3_600_000;

export class Hub extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      await this.syncConfig();
    });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const due = this.sql
      .exec<MonitorRow>("SELECT * FROM monitor WHERE next_at IS NOT NULL AND next_at <= ? ORDER BY next_at", now)
      .toArray();
    const checks = due.filter((m) => m.kind !== "heartbeat");
    for (let i = 0; i < checks.length; i += CONCURRENCY) {
      const batch = checks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((m) => runCheck(m)));
      for (const [index, monitor] of batch.entries()) await this.recordCheck(monitor, results[index]!, now);
    }
    for (const monitor of due.filter((m) => m.kind === "heartbeat")) await this.heartbeatMissed(monitor, now);
    await this.schedule();
  }

  async heartbeat(token: string): Promise<boolean> {
    const monitor = this.sql
      .exec<MonitorRow>("SELECT * FROM monitor WHERE kind = 'heartbeat' AND token = ?", token)
      .toArray()[0];
    if (!monitor) return false;
    const now = Date.now();
    const deadline = now + (monitor.interval_sec + monitor.grace_sec) * 1000;
    this.sql.exec(
      "UPDATE monitor SET last_at = ?, next_at = ?, last_detail = 'ping', failures = 0 WHERE id = ?",
      now, deadline, monitor.id,
    );
    this.rollup(monitor.id, now, true, null);
    await this.transition(monitor, "up", now, "heartbeat received");
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > deadline) await this.ctx.storage.setAlarm(deadline);
    return true;
  }

  snapshot(): PublicMonitor[] {
    const since = Math.floor(Date.now() / HOUR) * HOUR - 23 * HOUR;
    const hours = this.sql
      .exec<{ monitor_id: string; hour: number; checks: number; ok: number }>(
        "SELECT monitor_id, hour, checks, ok FROM rollup WHERE hour >= ? ORDER BY hour",
        since,
      )
      .toArray();
    return this.sql
      .exec<MonitorRow>("SELECT * FROM monitor ORDER BY name")
      .toArray()
      .map((m) => {
        const mine = hours.filter((h) => h.monitor_id === m.id);
        const checks = mine.reduce((n, h) => n + h.checks, 0);
        const ok = mine.reduce((n, h) => n + h.ok, 0);
        return {
          id: m.id,
          name: m.name,
          kind: m.kind,
          status: m.status,
          lastAt: m.last_at,
          lastMs: m.last_ms,
          detail: m.last_detail,
          since: m.changed_at,
          uptime24h: checks ? ok / checks : null,
          hours: mine.map(({ hour, checks, ok }) => ({ hour, checks, ok })),
        };
      });
  }

  adminMonitors(): Pick<MonitorRow, "id" | "name" | "kind" | "token" | "status">[] {
    return this.sql
      .exec<MonitorRow>("SELECT id, name, kind, token, status FROM monitor ORDER BY name")
      .toArray();
  }

  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS monitor (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        target TEXT,
        interval_sec INTEGER NOT NULL,
        timeout_ms INTEGER NOT NULL,
        grace_sec INTEGER NOT NULL,
        token TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        failures INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER,
        last_at INTEGER,
        last_ms INTEGER,
        last_detail TEXT,
        changed_at INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS rollup (
        monitor_id TEXT NOT NULL,
        hour INTEGER NOT NULL,
        checks INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        ms_sum INTEGER NOT NULL,
        ms_count INTEGER NOT NULL,
        PRIMARY KEY (monitor_id, hour)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS event (
        monitor_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        PRIMARY KEY (monitor_id, at)
      ) WITHOUT ROWID;
    `);
  }

  // Config lives in code; apply it only when it changed so a wake-up costs no writes.
  private async syncConfig(): Promise<void> {
    const version = JSON.stringify(MONITORS);
    const stored = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'config'").toArray()[0];
    if (stored?.value === version) return;
    const now = Date.now();
    const ids = MONITORS.map((m) => m.id);
    this.sql.exec(`DELETE FROM monitor WHERE id NOT IN (${ids.map(() => "?").join(",")})`, ...ids);
    for (const m of MONITORS) {
      const target = m.kind === "heartbeat" ? null : m.target;
      const timeout = m.kind === "heartbeat" ? 0 : (m.timeoutMs ?? 10_000);
      const grace = m.kind === "heartbeat" ? m.graceSec : 0;
      const firstDue = m.kind === "heartbeat" ? now + (m.intervalSec + grace) * 1000 : nextSlot(m.id, m.intervalSec, now);
      this.sql.exec(
        `INSERT INTO monitor (id, name, kind, target, interval_sec, timeout_ms, grace_sec, token, next_at, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, target = excluded.target,
           interval_sec = excluded.interval_sec, timeout_ms = excluded.timeout_ms, grace_sec = excluded.grace_sec,
           token = coalesce(monitor.token, excluded.token), next_at = coalesce(monitor.next_at, excluded.next_at)`,
        m.id, m.name, m.kind, target, m.intervalSec, timeout, grace,
        m.kind === "heartbeat" ? randomToken() : null, firstDue, now,
      );
    }
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('config', ?)", version);
    await this.schedule();
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

  private async heartbeatMissed(monitor: MonitorRow, now: number): Promise<void> {
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

  private async transition(monitor: MonitorRow, status: Status, now: number, detail: string): Promise<void> {
    if (monitor.status === status) return;
    this.sql.exec("UPDATE monitor SET status = ?, changed_at = ? WHERE id = ?", status, now, monitor.id);
    this.sql.exec("INSERT OR REPLACE INTO event (monitor_id, at, status, detail) VALUES (?, ?, ?, ?)", monitor.id, now, status, detail);
    // A monitor's first result is not news; only real changes alert.
    if (monitor.status !== "pending" || status === "down") await this.alert(monitor, status, now, detail);
  }

  // Same body as OpenUptime's webhook channel, so existing receivers (kukuroo's /hook/openuptime) keep working.
  // An incident spans one down period; it is named after the monitor and the moment it went down.
  private async alert(monitor: MonitorRow, status: Status, at: number, detail: string): Promise<void> {
    if (!this.env.ALERT_WEBHOOK_URL) {
      console.warn("alert skipped: ALERT_WEBHOOK_URL is not set", monitor.id, status);
      return;
    }
    const startedAt = status === "down" ? at : monitor.changed_at;
    const body = {
      kind: status === "down" ? "incident.opened" : "incident.resolved",
      incident: {
        id: `${monitor.id}-${startedAt}`,
        title: status === "down" ? detail : `${monitor.name} recovered`,
        startedAt: new Date(startedAt).toISOString(),
        resolvedAt: status === "down" ? null : new Date(at).toISOString(),
      },
      monitor: { name: monitor.name, target: monitor.target ?? "" },
    };
    try {
      const res = await fetch(this.env.ALERT_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "tiny-uptime/0.1" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) console.log("alert sent", monitor.id, body.kind);
      else console.error("alert webhook rejected", monitor.id, res.status);
    } catch (error) {
      console.error("alert webhook failed", monitor.id, error);
    }
  }

  private async schedule(): Promise<void> {
    const next = this.sql.exec<{ at: number | null }>("SELECT min(next_at) AS at FROM monitor").toArray()[0]?.at;
    if (next == null) return;
    const current = await this.ctx.storage.getAlarm();
    if (current !== next) await this.ctx.storage.setAlarm(next);
  }
}

function runCheck(monitor: MonitorRow): Promise<CheckResult> {
  if (monitor.kind === "minecraft") return checkMinecraft(monitor.target ?? "", monitor.timeout_ms);
  return checkHttp(monitor.target ?? "", monitor.timeout_ms);
}

// Each monitor checks at a fixed offset within its interval, so monitors spread out instead of firing together.
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

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
