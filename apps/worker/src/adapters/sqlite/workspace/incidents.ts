import type { Incident, IncidentListing, IncidentRepository } from "@tiny-uptime/core";
import { bool, first } from "../rows";

type Row = {
  id: string;
  monitor_id: string;
  kind: Incident["kind"];
  started_at: number;
  resolved_at: number | null;
  cause: string;
  acknowledged_at: number | null;
  acknowledged_by: string | null;
  notified: number;
  reminders: number;
  last_reminder_at: number | null;
  escalated_at: number | null;
};

export class SqliteIncidents implements IncidentRepository {
  constructor(private readonly sql: SqlStorage) {}

  insert(i: Incident): void {
    this.sql.exec(
      `INSERT INTO incident (id, monitor_id, kind, started_at, resolved_at, cause, acknowledged_at, acknowledged_by, notified, reminders, last_reminder_at, escalated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      i.id,
      i.monitorId,
      i.kind,
      i.startedAt,
      i.resolvedAt,
      i.cause,
      i.acknowledgedAt,
      i.acknowledgedBy,
      i.notified ? 1 : 0,
      i.reminders,
      i.lastReminderAt,
      i.escalatedAt,
    );
  }

  get(id: string): Incident | null {
    const row = first(this.sql.exec<Row>("SELECT * FROM incident WHERE id = ?", id));
    return row && toIncident(row);
  }

  resolve(id: string, at: number): void {
    this.sql.exec("UPDATE incident SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL", at, id);
  }

  open(): Incident[] {
    return this.sql.exec<Row>("SELECT * FROM incident WHERE resolved_at IS NULL ORDER BY started_at").toArray().map(toIncident);
  }

  acknowledge(id: string, at: number, by: string): void {
    this.sql.exec("UPDATE incident SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL", at, by, id);
  }

  recordReminder(id: string, at: number): void {
    this.sql.exec("UPDATE incident SET reminders = reminders + 1, last_reminder_at = ? WHERE id = ?", at, id);
  }

  markEscalated(id: string, at: number): void {
    this.sql.exec("UPDATE incident SET escalated_at = ? WHERE id = ?", at, id);
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
  return {
    id: row.id,
    monitorId: row.monitor_id,
    kind: row.kind,
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
    cause: row.cause,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    notified: bool(row.notified),
    reminders: row.reminders,
    lastReminderAt: row.last_reminder_at,
    escalatedAt: row.escalated_at,
  };
}
