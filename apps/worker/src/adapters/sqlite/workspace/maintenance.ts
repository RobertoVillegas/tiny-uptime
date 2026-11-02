import type { MaintenanceRepository, MaintenanceWindow, Recurrence } from "@tiny-uptime/core";
import { first, json } from "../rows";

type Row = {
  id: string;
  name: string;
  monitor_ids: string;
  starts_at: number;
  ends_at: number;
  recurrence: string | null;
  created_at: number;
};

export class SqliteMaintenance implements MaintenanceRepository {
  constructor(private readonly sql: SqlStorage) {}

  list(): MaintenanceWindow[] {
    return this.sql.exec<Row>("SELECT * FROM maintenance ORDER BY starts_at").toArray().map(toWindow);
  }

  get(id: string): MaintenanceWindow | null {
    const row = first(this.sql.exec<Row>("SELECT * FROM maintenance WHERE id = ?", id));
    return row && toWindow(row);
  }

  insert(w: MaintenanceWindow): void {
    this.sql.exec(
      "INSERT INTO maintenance (id, name, monitor_ids, starts_at, ends_at, recurrence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      w.id,
      w.name,
      JSON.stringify(w.monitorIds),
      w.startsAt,
      w.endsAt,
      w.recurrence ? JSON.stringify(w.recurrence) : null,
      w.createdAt,
    );
  }

  save(w: MaintenanceWindow): void {
    this.sql.exec(
      "UPDATE maintenance SET name = ?, monitor_ids = ?, starts_at = ?, ends_at = ?, recurrence = ? WHERE id = ?",
      w.name,
      JSON.stringify(w.monitorIds),
      w.startsAt,
      w.endsAt,
      w.recurrence ? JSON.stringify(w.recurrence) : null,
      w.id,
    );
  }

  delete(id: string): void {
    this.sql.exec("DELETE FROM maintenance WHERE id = ?", id);
  }
}

function toWindow(row: Row): MaintenanceWindow {
  return {
    id: row.id,
    name: row.name,
    monitorIds: json(row.monitor_ids),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    recurrence: row.recurrence ? json<Recurrence>(row.recurrence) : null,
    createdAt: row.created_at,
  };
}
