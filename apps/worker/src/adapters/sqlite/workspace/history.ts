import type { HistoryRepository, HourlyPoint } from "@tiny-uptime/core";

const HOUR = 3_600_000;
type Row = {
  monitor_id: string;
  hour: number;
  checks: number;
  ok: number;
  ms_sum: number;
  ms_count: number;
  ms_min: number | null;
  ms_max: number | null;
};

/** One row per monitor and hour: a check costs one upsert, and a day of history is 24 rows. */
export class SqliteHistory implements HistoryRepository {
  constructor(private readonly sql: SqlStorage) {}

  record(monitorId: string, at: number, sample: { ok: boolean; latencyMs: number | null }): void {
    this.sql.exec(
      `INSERT INTO rollup (monitor_id, hour, checks, ok, ms_sum, ms_count, ms_min, ms_max) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT (monitor_id, hour) DO UPDATE SET checks = checks + 1, ok = ok + excluded.ok,
         ms_sum = ms_sum + excluded.ms_sum, ms_count = ms_count + excluded.ms_count,
         ms_min = min(coalesce(ms_min, excluded.ms_min), coalesce(excluded.ms_min, ms_min)),
         ms_max = max(coalesce(ms_max, excluded.ms_max), coalesce(excluded.ms_max, ms_max))`,
      monitorId,
      Math.floor(at / HOUR) * HOUR,
      sample.ok ? 1 : 0,
      sample.latencyMs ?? 0,
      sample.latencyMs === null ? 0 : 1,
      sample.latencyMs,
      sample.latencyMs,
    );
  }

  hourly(monitorId: string, since: number): HourlyPoint[] {
    return this.sql
      .exec<Row>("SELECT * FROM rollup WHERE monitor_id = ? AND hour >= ? ORDER BY hour", monitorId, since)
      .toArray()
      .map(toPoint);
  }

  publicHourly(since: number): (HourlyPoint & { monitorId: string })[] {
    return this.sql
      .exec<Row>("SELECT r.* FROM rollup r JOIN monitor m ON m.id = r.monitor_id WHERE m.public = 1 AND r.hour >= ? ORDER BY r.hour", since)
      .toArray()
      .map((row) => ({ ...toPoint(row), monitorId: row.monitor_id }));
  }

  deleteForMonitor(monitorId: string): void {
    this.sql.exec("DELETE FROM rollup WHERE monitor_id = ?", monitorId);
  }

  purgeBefore(cutoff: number): void {
    this.sql.exec("DELETE FROM rollup WHERE hour < ?", cutoff);
  }
}

function toPoint(row: Row): HourlyPoint {
  return {
    hour: row.hour,
    checks: row.checks,
    ok: row.ok,
    latencySum: row.ms_sum,
    latencyCount: row.ms_count,
    latencyMin: row.ms_min,
    latencyMax: row.ms_max,
  };
}
