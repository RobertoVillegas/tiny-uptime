import { DurableObject } from "cloudflare:workers";
import type { WorkspaceEntry } from "@tiny-uptime/contracts";
import type { PublicTarget } from "../adapters/http/routes/public";
import type { Env } from "./env";

/**
 * The one place that knows every workspace and every public address: workspace slugs, status page
 * slugs and custom domains, all unique across the instance. Monitoring traffic never goes through here.
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
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS page_address (
      page_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      custom_domain TEXT UNIQUE
    ) WITHOUT ROWID`);
  }

  register(id: string, name: string, slug: string): WorkspaceEntry | { error: string } {
    if (this.slugTaken(slug, null)) return { error: "slug is taken" };
    const now = Date.now();
    this.sql.exec("INSERT INTO workspace (id, name, slug, created_at) VALUES (?, ?, ?, ?)", id, name, slug, now);
    return { id, name, slug, createdAt: new Date(now).toISOString() };
  }

  /** Claims (or moves) a status page's slug and custom domain; refuses ones another page or workspace holds. */
  claimPage(
    workspaceId: string,
    pageId: string,
    slug: string,
    customDomain: string | null,
  ): { ok: true } | { error: string; field: "slug" | "customDomain" } {
    if (this.slugTaken(slug, pageId)) return { error: "this slug is taken", field: "slug" };
    if (customDomain) {
      const holder = this.sql
        .exec<{ page_id: string }>("SELECT page_id FROM page_address WHERE custom_domain = ?", customDomain)
        .toArray()[0];
      if (holder && holder.page_id !== pageId) return { error: "another status page uses this domain", field: "customDomain" };
    }
    this.sql.exec(
      `INSERT INTO page_address (page_id, workspace_id, slug, custom_domain) VALUES (?, ?, ?, ?)
       ON CONFLICT (page_id) DO UPDATE SET slug = excluded.slug, custom_domain = excluded.custom_domain`,
      pageId,
      workspaceId,
      slug,
      customDomain,
    );
    return { ok: true };
  }

  releasePage(pageId: string): void {
    this.sql.exec("DELETE FROM page_address WHERE page_id = ?", pageId);
  }

  resolve(slug: string): PublicTarget | null {
    const page = this.sql
      .exec<{ workspace_id: string; page_id: string }>("SELECT workspace_id, page_id FROM page_address WHERE slug = ?", slug)
      .toArray()[0];
    if (page) return { workspaceId: page.workspace_id, pageId: page.page_id };
    const workspace = this.sql.exec<{ id: string }>("SELECT id FROM workspace WHERE slug = ?", slug).toArray()[0];
    return workspace ? { workspaceId: workspace.id, pageId: null } : null;
  }

  resolveHost(host: string): PublicTarget | null {
    const page = this.sql
      .exec<{ workspace_id: string; page_id: string }>(
        "SELECT workspace_id, page_id FROM page_address WHERE custom_domain = ?",
        host.toLowerCase(),
      )
      .toArray()[0];
    return page ? { workspaceId: page.workspace_id, pageId: page.page_id } : null;
  }

  list(): WorkspaceEntry[] {
    return this.sql
      .exec<{ id: string; name: string; slug: string; created_at: number }>("SELECT * FROM workspace ORDER BY created_at")
      .toArray()
      .map((w) => ({ id: w.id, name: w.name, slug: w.slug, createdAt: new Date(w.created_at).toISOString() }));
  }

  private slugTaken(slug: string, exceptPageId: string | null): boolean {
    if (this.sql.exec("SELECT 1 FROM workspace WHERE slug = ?", slug).toArray().length) return true;
    const page = this.sql.exec<{ page_id: string }>("SELECT page_id FROM page_address WHERE slug = ?", slug).toArray()[0];
    return page !== undefined && page.page_id !== exceptPageId;
  }
}
