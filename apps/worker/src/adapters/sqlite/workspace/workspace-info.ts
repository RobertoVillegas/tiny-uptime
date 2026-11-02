import type { ApiKey, ApiKeyRepository, WorkspaceInfoRepository } from "@tiny-uptime/core";
import { first } from "../rows";
import { MIGRATIONS } from "./schema";

/**
 * The workspace's identity, schema version and housekeeping marks. The schema only exists once the
 * operator initializes the workspace, so a request for a guessed id never writes anything.
 */
export class SqliteWorkspaceInfo implements WorkspaceInfoRepository {
  constructor(private readonly sql: SqlStorage) {
    if (this.exists()) this.migrate();
  }

  get(): { id: string; name: string } | null {
    if (!this.exists()) return null;
    const id = this.meta("id");
    return id ? { id, name: this.meta("name") ?? "" } : null;
  }

  init(id: string, name: string, now: number): void {
    this.migrate();
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('id', ?), ('name', ?), ('created_at', ?)", id, name, String(now));
  }

  lastCleanupAt(): number {
    return Number(this.meta("cleanup_at") ?? "0");
  }

  setLastCleanupAt(at: number): void {
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('cleanup_at', ?)", String(at));
  }

  private exists(): boolean {
    return this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length > 0;
  }

  private meta(key: string): string | null {
    return first(this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key))?.value ?? null;
  }

  private migrate(): void {
    const applied = this.exists() ? Number(this.meta("schema") ?? "0") : 0;
    for (let version = applied; version < MIGRATIONS.length; version++) {
      this.sql.exec(MIGRATIONS[version]!);
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)", String(version + 1));
    }
  }
}

type KeyRow = { id: string; name: string; hash: string; hint: string; created_at: number; last_used_at: number | null };

export class SqliteApiKeys implements ApiKeyRepository {
  constructor(private readonly sql: SqlStorage) {}

  list(): ApiKey[] {
    return this.sql.exec<KeyRow>("SELECT * FROM api_key ORDER BY created_at").toArray().map(toKey);
  }

  insert(k: ApiKey): void {
    this.sql.exec("INSERT INTO api_key (id, name, hash, hint, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)", k.id, k.name, k.hash, k.hint, k.createdAt, k.lastUsedAt);
  }

  delete(id: string): boolean {
    return this.sql.exec("DELETE FROM api_key WHERE id = ?", id).rowsWritten > 0;
  }

  byHash(hash: string): ApiKey | null {
    const row = first(this.sql.exec<KeyRow>("SELECT * FROM api_key WHERE hash = ?", hash));
    return row && toKey(row);
  }

  touch(id: string, at: number): void {
    this.sql.exec("UPDATE api_key SET last_used_at = ? WHERE id = ?", at, id);
  }
}

function toKey(row: KeyRow): ApiKey {
  return { id: row.id, name: row.name, hash: row.hash, hint: row.hint, createdAt: row.created_at, lastUsedAt: row.last_used_at };
}
