import type { IncidentUpdate, IncidentUpdateRepository, StatusComponent, StatusPage, StatusPageRepository } from "@tiny-uptime/core";
import { bool, first } from "../rows";

type PageRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  theme: StatusPage["theme"];
  language: StatusPage["language"];
  time_zone: string;
  history_days: StatusPage["historyDays"];
  incident_days: StatusPage["incidentDays"];
  history_reset_at: number | null;
  show_latency: number;
  external_url: string | null;
  hide_branding: number;
  ok_pct: number;
  warn_pct: number;
  custom_domain: string | null;
  created_at: number;
};

type ComponentRow = { page_id: string; monitor_id: string; group_name: string; position: number };
type UpdateRow = {
  id: string;
  incident_id: string;
  status: IncidentUpdate["status"];
  body: string;
  visibility: IncidentUpdate["visibility"];
  author: string | null;
  created_at: number;
};

export class SqliteStatusPages implements StatusPageRepository {
  constructor(private readonly sql: SqlStorage) {}

  list(): StatusPage[] {
    return this.sql.exec<PageRow>("SELECT * FROM status_page ORDER BY title").toArray().map(toPage);
  }

  get(id: string): StatusPage | null {
    const row = first(this.sql.exec<PageRow>("SELECT * FROM status_page WHERE id = ?", id));
    return row && toPage(row);
  }

  bySlug(slug: string): StatusPage | null {
    const row = first(this.sql.exec<PageRow>("SELECT * FROM status_page WHERE slug = ?", slug));
    return row && toPage(row);
  }

  insert(p: StatusPage): void {
    this.sql.exec(
      `INSERT INTO status_page (id, slug, title, description, theme, show_latency, external_url, hide_branding, ok_pct, warn_pct, custom_domain,
         language, time_zone, history_days, incident_days, history_reset_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...values(p),
      p.createdAt,
    );
  }

  save(p: StatusPage): void {
    this.sql.exec(
      `UPDATE status_page SET slug = ?, title = ?, description = ?, theme = ?, show_latency = ?, external_url = ?, hide_branding = ?,
         ok_pct = ?, warn_pct = ?, custom_domain = ?, language = ?, time_zone = ?, history_days = ?, incident_days = ?,
         history_reset_at = ? WHERE id = ?`,
      ...values(p).slice(1),
      p.id,
    );
  }

  delete(id: string): void {
    this.sql.exec("DELETE FROM status_component WHERE page_id = ?", id);
    this.sql.exec("DELETE FROM status_page WHERE id = ?", id);
  }

  components(pageId: string): StatusComponent[] {
    return this.sql
      .exec<ComponentRow>("SELECT * FROM status_component WHERE page_id = ? ORDER BY position", pageId)
      .toArray()
      .map((r) => ({ pageId: r.page_id, monitorId: r.monitor_id, group: r.group_name, position: r.position }));
  }

  setComponents(pageId: string, components: StatusComponent[]): void {
    this.sql.exec("DELETE FROM status_component WHERE page_id = ?", pageId);
    for (const c of components) {
      this.sql.exec(
        "INSERT INTO status_component (page_id, monitor_id, group_name, position) VALUES (?, ?, ?, ?)",
        pageId,
        c.monitorId,
        c.group,
        c.position,
      );
    }
  }

  dropMonitor(monitorId: string): void {
    this.sql.exec("DELETE FROM status_component WHERE monitor_id = ?", monitorId);
  }
}

export class SqliteIncidentUpdates implements IncidentUpdateRepository {
  constructor(private readonly sql: SqlStorage) {}

  insert(u: IncidentUpdate): void {
    this.sql.exec(
      "INSERT INTO incident_update (id, incident_id, status, body, visibility, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      u.id,
      u.incidentId,
      u.status,
      u.body,
      u.visibility,
      u.author,
      u.createdAt,
    );
  }

  forIncidents(incidentIds: string[], publicOnly: boolean): IncidentUpdate[] {
    if (incidentIds.length === 0) return [];
    const placeholders = incidentIds.map(() => "?").join(", ");
    const visibility = publicOnly ? "AND visibility = 'public'" : "";
    return this.sql
      .exec<UpdateRow>(
        `SELECT * FROM incident_update WHERE incident_id IN (${placeholders}) ${visibility} ORDER BY created_at`,
        ...incidentIds,
      )
      .toArray()
      .map((r) => ({
        id: r.id,
        incidentId: r.incident_id,
        status: r.status,
        body: r.body,
        visibility: r.visibility,
        author: r.author,
        createdAt: r.created_at,
      }));
  }

  deleteForIncidentsOf(monitorId: string): void {
    this.sql.exec("DELETE FROM incident_update WHERE incident_id IN (SELECT id FROM incident WHERE monitor_id = ?)", monitorId);
  }
}

function values(p: StatusPage): SqlStorageValue[] {
  return [
    p.id,
    p.slug,
    p.title,
    p.description,
    p.theme,
    p.showLatency ? 1 : 0,
    p.externalUrl,
    p.hideBranding ? 1 : 0,
    p.okPct,
    p.warnPct,
    p.customDomain,
    p.language,
    p.timeZone,
    p.historyDays,
    p.incidentDays,
    p.historyResetAt,
  ];
}

function toPage(r: PageRow): StatusPage {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    theme: r.theme,
    language: r.language,
    timeZone: r.time_zone,
    historyDays: r.history_days,
    incidentDays: r.incident_days,
    historyResetAt: r.history_reset_at,
    showLatency: bool(r.show_latency),
    externalUrl: r.external_url,
    hideBranding: bool(r.hide_branding),
    okPct: r.ok_pct,
    warnPct: r.warn_pct,
    customDomain: r.custom_domain,
    createdAt: r.created_at,
  };
}
