import type { PasskeyRepository, StoredPasskey } from "@tiny-uptime/core";
import { first, json } from "../rows";

type Row = {
  id: string;
  user_id: string;
  public_key: string;
  algorithm: StoredPasskey["algorithm"];
  transports: string;
  counter: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
};

export class SqlitePasskeys implements PasskeyRepository {
  constructor(private readonly sql: SqlStorage) {}

  get(id: string): StoredPasskey | null {
    const row = first(this.sql.exec<Row>("SELECT * FROM passkey WHERE id = ?", id));
    return row && toPasskey(row);
  }

  forUser(userId: string): StoredPasskey[] {
    return this.sql.exec<Row>("SELECT * FROM passkey WHERE user_id = ? ORDER BY created_at", userId).toArray().map(toPasskey);
  }

  insert(p: StoredPasskey): void {
    this.sql.exec(
      "INSERT INTO passkey (id, user_id, public_key, algorithm, transports, counter, name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      p.id,
      p.userId,
      p.publicKey,
      p.algorithm,
      JSON.stringify(p.transports),
      p.counter,
      p.name,
      p.createdAt,
      p.lastUsedAt,
    );
  }

  recordUse(id: string, counter: number, at: number): void {
    this.sql.exec("UPDATE passkey SET counter = ?, last_used_at = ? WHERE id = ?", counter, at, id);
  }

  delete(id: string, userId: string): boolean {
    return this.sql.exec("DELETE FROM passkey WHERE id = ? AND user_id = ?", id, userId).rowsWritten > 0;
  }
}

function toPasskey(row: Row): StoredPasskey {
  return {
    id: row.id,
    userId: row.user_id,
    publicKey: row.public_key,
    algorithm: row.algorithm,
    transports: json(row.transports),
    counter: row.counter,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}
