import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export type WorkspaceEntry = { id: string; name: string; slug: string; createdAt: string };

/**
 * The one place that knows every workspace: slugs for public status pages and the list the
 * operator sees. Monitoring traffic never goes through here.
 */
export class Directory extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS workspace (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    ) WITHOUT ROWID`);
  }

  register(id: string, name: string, slug: string): WorkspaceEntry | { error: string } {
    if (this.sql.exec("SELECT 1 FROM workspace WHERE slug = ?", slug).toArray().length) return { error: "slug is taken" };
    const now = Date.now();
    this.sql.exec("INSERT INTO workspace (id, name, slug, created_at) VALUES (?, ?, ?, ?)", id, name, slug, now);
    return { id, name, slug, createdAt: new Date(now).toISOString() };
  }

  resolve(slug: string): string | null {
    return this.sql.exec<{ id: string }>("SELECT id FROM workspace WHERE slug = ?", slug).toArray()[0]?.id ?? null;
  }

  list(): WorkspaceEntry[] {
    return this.sql
      .exec<{ id: string; name: string; slug: string; created_at: number }>("SELECT * FROM workspace ORDER BY created_at")
      .toArray()
      .map((w) => ({ id: w.id, name: w.name, slug: w.slug, createdAt: new Date(w.created_at).toISOString() }));
  }
}
