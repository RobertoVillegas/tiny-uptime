import { DEFAULT_OPTIONS, type Monitor, type MonitorOptions, type MonitorRepository } from "@tiny-uptime/core";
import { bool, first, json } from "../rows";

type Row = {
  id: string;
  name: string;
  type: Monitor["type"];
  config: string;
  options: string;
  interval_sec: number;
  paused: number;
  public: number;
  heartbeat_token: string | null;
  status: Monitor["state"]["status"];
  failures: number;
  successes: number;
  slow_streak: number;
  open_incident: string | null;
  open_slow_incident: string | null;
  next_at: number | null;
  last_at: number | null;
  last_ms: number | null;
  last_detail: string | null;
  changed_at: number;
  created_at: number;
  updated_at: number;
};

/** Column order shared by insert and update. */
const COLUMNS = [
  "name",
  "type",
  "config",
  "options",
  "interval_sec",
  "paused",
  "public",
  "heartbeat_token",
  "status",
  "failures",
  "successes",
  "slow_streak",
  "open_incident",
  "open_slow_incident",
  "next_at",
  "last_at",
  "last_ms",
  "last_detail",
  "changed_at",
  "created_at",
  "updated_at",
] as const;

const INSERT = `INSERT INTO monitor (id, ${COLUMNS.join(", ")}) VALUES (?${", ?".repeat(COLUMNS.length)})`;
const UPDATE = `UPDATE monitor SET ${COLUMNS.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`;

export class SqliteMonitors implements MonitorRepository {
  constructor(private readonly sql: SqlStorage) {}

  list(): Monitor[] {
    return this.sql.exec<Row>("SELECT * FROM monitor ORDER BY name").toArray().map(toMonitor);
  }

  listPublic(): Monitor[] {
    return this.sql.exec<Row>("SELECT * FROM monitor WHERE public = 1 ORDER BY name").toArray().map(toMonitor);
  }

  get(id: string): Monitor | null {
    const row = first(this.sql.exec<Row>("SELECT * FROM monitor WHERE id = ?", id));
    return row && toMonitor(row);
  }

  byHeartbeatToken(token: string): Monitor | null {
    const row = first(this.sql.exec<Row>("SELECT * FROM monitor WHERE heartbeat_token = ? AND type = 'heartbeat'", token));
    return row && toMonitor(row);
  }

  due(now: number): Monitor[] {
    return this.sql
      .exec<Row>("SELECT * FROM monitor WHERE paused = 0 AND next_at IS NOT NULL AND next_at <= ? ORDER BY next_at", now)
      .toArray()
      .map(toMonitor);
  }

  insert(m: Monitor): void {
    this.sql.exec(INSERT, m.id, ...values(m));
  }

  save(m: Monitor): void {
    this.sql.exec(UPDATE, ...values(m), m.id);
  }

  delete(id: string): void {
    this.sql.exec("DELETE FROM monitor WHERE id = ?", id);
  }
}

function values(m: Monitor): SqlStorageValue[] {
  const s = m.state;
  return [
    m.name,
    m.type,
    JSON.stringify(m.config),
    JSON.stringify(m.options),
    m.intervalSec,
    m.paused ? 1 : 0,
    m.public ? 1 : 0,
    m.heartbeatToken,
    s.status,
    s.failures,
    s.successes,
    s.slowStreak,
    s.openIncidentId,
    s.openSlowIncidentId,
    s.nextCheckAt,
    s.lastCheckedAt,
    s.lastLatencyMs,
    s.lastDetail,
    s.statusChangedAt,
    m.createdAt,
    m.updatedAt,
  ];
}

function toMonitor(row: Row): Monitor {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: json(row.config),
    // Monitors saved before options existed get the defaults.
    options: { ...DEFAULT_OPTIONS, ...json<Partial<MonitorOptions>>(row.options) },
    intervalSec: row.interval_sec,
    paused: bool(row.paused),
    public: bool(row.public),
    heartbeatToken: row.heartbeat_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state: {
      status: row.status,
      failures: row.failures,
      successes: row.successes,
      slowStreak: row.slow_streak,
      openIncidentId: row.open_incident,
      openSlowIncidentId: row.open_slow_incident,
      nextCheckAt: row.next_at,
      lastCheckedAt: row.last_at,
      lastLatencyMs: row.last_ms,
      lastDetail: row.last_detail,
      statusChangedAt: row.changed_at,
    },
  } as Monitor;
}
