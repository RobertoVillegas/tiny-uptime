import type { Incident, IncidentListing, IncidentRepository } from "@tiny-uptime/core";
import { first } from "../rows";

type Row = { id: string; monitor_id: string; started_at: number; resolved_at: number | null; cause: string };

export class SqliteIncidents implements IncidentRepository {
  constructor(private readonly sql: SqlStorage) {}

  insert(i: Incident): void {
    this.sql.exec("INSERT INTO incident (id, monitor_id, started_at, resolved_at, cause) VALUES (?, ?, ?, ?, ?)", i.id, i.monitorId, i.startedAt, i.resolvedAt, i.cause);
  }

  get(id: string): Incident | null {
    const row = first(this.sql.exec<Row>("SELECT * FROM incident WHERE id = ?", id));
    return row && toIncident(row);
  }

  resolve(id: string, at: number): void {
    this.sql.exec("UPDATE incident SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL", at, id);
  }

  list(query: { limit: number; monitorId?: string }): IncidentListing[] {
    const filter = query.monitorId ? "WHERE i.monitor_id = ?" : "";
    const params = query.monitorId ? [query.monitorId, query.limit] : [query.limit];
    return this.sql
      .exec<Row & { name: string | null }>(
        `SELECT i.*, m.name FROM incident i LEFT JOIN monitor m ON m.id = i.monitor_id ${filter} ORDER BY i.started_at DESC LIMIT ?`,
        ...params,
      )
      .toArray()
      .map((row) => ({ ...toIncident(row), monitorName: row.name }));
  }

  deleteForMonitor(monitorId: string): void {
    this.sql.exec("DELETE FROM incident WHERE monitor_id = ?", monitorId);
  }

  purgeResolvedBefore(cutoff: number): void {
    this.sql.exec("DELETE FROM incident WHERE resolved_at IS NOT NULL AND resolved_at < ?", cutoff);
  }
}

function toIncident(row: Row): Incident {
  return { id: row.id, monitorId: row.monitor_id, startedAt: row.started_at, resolvedAt: row.resolved_at, cause: row.cause };
}
