import { parseChannel, redactChannel, type ChannelFields } from "../channels";
import { newApiKey, newHeartbeatToken, newId } from "../lib/ids";
import { asObject, InvalidInput, str } from "../lib/validate";
import { flatten, mergeMonitor, parseMonitor, type MonitorFields } from "../monitors/model";
import type { MonitorRow, Workspace } from "./workspace";

export type ApiRequest = {
  keyHash: string;
  method: string;
  /** Path below /api/v1, e.g. "/monitors/abc". */
  path: string;
  query: Record<string, string>;
  body: unknown;
  /** Public origin of the Worker, for building heartbeat URLs. */
  origin: string;
};

export type ApiResponse = { status: number; body: unknown };

class NotFound extends Error {}

const HOUR = 3_600_000;

export async function handleApi(ws: Workspace, req: ApiRequest): Promise<ApiResponse> {
  try {
    return await route(ws, req);
  } catch (error) {
    if (error instanceof InvalidInput) return { status: 400, body: { error: error.message, field: error.field } };
    if (error instanceof NotFound) return { status: 404, body: { error: error.message || "not found" } };
    throw error;
  }
}

async function route(ws: Workspace, req: ApiRequest): Promise<ApiResponse> {
  const [resource, id, action] = req.path.split("/").filter(Boolean);
  const { method } = req;

  if (resource === "workspace" && !id && method === "GET") {
    return ok({ id: ws.meta("id"), name: ws.meta("name") });
  }

  if (resource === "monitors") {
    if (!id && method === "GET") return ok(listMonitors(ws, req.origin));
    if (!id && method === "POST") return { status: 201, body: await createMonitor(ws, req) };
    if (id && !action && method === "GET") return ok(serialize(found(ws.monitor(id)), req.origin));
    if (id && !action && method === "PATCH") return ok(await updateMonitor(ws, id, req));
    if (id && !action && method === "DELETE") return deleteMonitor(ws, id);
    if (id && action === "stats" && method === "GET") return ok(stats(ws, id, req.query));
  }

  if (resource === "incidents" && !id && method === "GET") return ok(listIncidents(ws, req.query));

  if (resource === "channels") {
    if (!id && method === "GET") return ok(listChannels(ws));
    if (!id && method === "POST") return { status: 201, body: createChannel(ws, req.body) };
    if (id && !action && method === "PATCH") return ok(updateChannel(ws, id, req.body));
    if (id && !action && method === "DELETE") {
      found(channelRow(ws, id));
      ws.sql.exec("DELETE FROM channel WHERE id = ?", id);
      ws.sql.exec("DELETE FROM delivery WHERE channel_id = ?", id);
      return { status: 204, body: null };
    }
    if (id && action === "test" && method === "POST") {
      const channel = toChannel(found(channelRow(ws, id)));
      try {
        await ws.sendTest(channel);
        return ok({ delivered: true });
      } catch (error) {
        return { status: 502, body: { delivered: false, error: error instanceof Error ? error.message : String(error) } };
      }
    }
  }

  if (resource === "api-keys") {
    if (!id && method === "GET") {
      return ok(
        ws.sql
          .exec<{ id: string; name: string; hint: string; created_at: number; last_used_at: number | null }>(
            "SELECT id, name, hint, created_at, last_used_at FROM api_key ORDER BY created_at",
          )
          .toArray()
          .map((k) => ({ id: k.id, name: k.name, hint: k.hint, createdAt: iso(k.created_at), lastUsedAt: iso(k.last_used_at) })),
      );
    }
    if (!id && method === "POST") {
      const name = str(asObject(req.body), "name", { max: 100 });
      const key = newApiKey(ws.meta("id")!);
      const created = await ws.createApiKey(name, key);
      return { status: 201, body: { ...created, key } };
    }
    if (id && method === "DELETE") {
      const deleted = ws.sql.exec("DELETE FROM api_key WHERE id = ?", id).rowsWritten;
      if (!deleted) throw new NotFound("API key not found");
      return { status: 204, body: null };
    }
  }

  return { status: 404, body: { error: `no route for ${method} /api/v1${req.path}` } };
}

// ---- monitors ----

function listMonitors(ws: Workspace, origin: string): unknown[] {
  return ws.sql.exec<MonitorRow>("SELECT * FROM monitor ORDER BY name").toArray().map((m) => serialize(m, origin));
}

async function createMonitor(ws: Workspace, req: ApiRequest): Promise<unknown> {
  const fields = parseMonitor(req.body);
  const now = Date.now();
  const id = newId();
  const token = fields.type === "heartbeat" ? newHeartbeatToken(ws.meta("id")!) : null;
  ws.sql.exec(
    `INSERT INTO monitor (id, name, type, config, interval_sec, paused, public, heartbeat_token, status, next_at, changed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, fields.name, fields.type, JSON.stringify(fields.config), fields.intervalSec, fields.paused ? 1 : 0, fields.public ? 1 : 0,
    token, fields.paused ? "paused" : "pending", firstDue(fields, now), now, now, now,
  );
  await ws.schedule();
  return serialize(ws.monitor(id)!, req.origin);
}

async function updateMonitor(ws: Workspace, id: string, req: ApiRequest): Promise<unknown> {
  const row = found(ws.monitor(id));
  const current = toFields(row);
  const next = mergeMonitor(current, req.body);
  const now = Date.now();
  const checkChanged = JSON.stringify(next.config) !== JSON.stringify(current.config) || next.intervalSec !== current.intervalSec;

  let status = row.status;
  let nextAt = row.next_at;
  if (next.paused && !current.paused) {
    ws.closeIncidentQuietly(row, now);
    ws.sql.exec("UPDATE monitor SET open_incident = NULL, failures = 0 WHERE id = ?", id);
    status = "paused";
    nextAt = null;
  } else if (!next.paused && current.paused) {
    status = "pending";
    nextAt = firstDue(next, now);
  } else if (!next.paused && checkChanged) {
    nextAt = next.type === "heartbeat" ? (row.last_at ?? now) + (next.intervalSec + next.config.graceSec) * 1000 : now;
  }

  ws.sql.exec(
    `UPDATE monitor SET name = ?, config = ?, interval_sec = ?, paused = ?, public = ?, status = ?, next_at = ?,
       changed_at = CASE WHEN status = ? THEN changed_at ELSE ? END, updated_at = ? WHERE id = ?`,
    next.name, JSON.stringify(next.config), next.intervalSec, next.paused ? 1 : 0, next.public ? 1 : 0, status, nextAt,
    status, now, now, id,
  );
  await ws.schedule();
  return serialize(ws.monitor(id)!, req.origin);
}

async function deleteMonitor(ws: Workspace, id: string): Promise<ApiResponse> {
  found(ws.monitor(id));
  ws.sql.exec("DELETE FROM monitor WHERE id = ?", id);
  ws.sql.exec("DELETE FROM rollup WHERE monitor_id = ?", id);
  ws.sql.exec("DELETE FROM incident WHERE monitor_id = ?", id);
  await ws.schedule();
  return { status: 204, body: null };
}

function stats(ws: Workspace, id: string, query: Record<string, string>): unknown {
  found(ws.monitor(id));
  const hours = Math.min(Math.max(Number(query.hours ?? 24) || 24, 1), 24 * 90);
  const since = Math.floor(Date.now() / HOUR) * HOUR - (hours - 1) * HOUR;
  const rows = ws.sql
    .exec<{ hour: number; checks: number; ok: number; ms_sum: number; ms_count: number }>(
      "SELECT hour, checks, ok, ms_sum, ms_count FROM rollup WHERE monitor_id = ? AND hour >= ? ORDER BY hour",
      id, since,
    )
    .toArray();
  const checks = rows.reduce((n, r) => n + r.checks, 0);
  const okCount = rows.reduce((n, r) => n + r.ok, 0);
  const msSum = rows.reduce((n, r) => n + r.ms_sum, 0);
  const msCount = rows.reduce((n, r) => n + r.ms_count, 0);
  return {
    hours,
    uptime: checks ? okCount / checks : null,
    avgLatencyMs: msCount ? Math.round(msSum / msCount) : null,
    series: rows.map((r) => ({
      hour: iso(r.hour),
      checks: r.checks,
      ok: r.ok,
      avgLatencyMs: r.ms_count ? Math.round(r.ms_sum / r.ms_count) : null,
    })),
  };
}

function serialize(row: MonitorRow, origin: string): Record<string, unknown> {
  return {
    id: row.id,
    ...flatten(toFields(row)),
    status: row.status,
    lastCheckedAt: iso(row.last_at),
    lastLatencyMs: row.last_ms,
    lastDetail: row.last_detail,
    statusChangedAt: iso(row.changed_at),
    nextCheckAt: iso(row.next_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.heartbeat_token ? { heartbeatUrl: `${origin}/api/heartbeat/${row.heartbeat_token}` } : {}),
  };
}

function toFields(row: MonitorRow): MonitorFields {
  return {
    type: row.type,
    config: JSON.parse(row.config),
    name: row.name,
    intervalSec: row.interval_sec,
    paused: row.paused === 1,
    public: row.public === 1,
  } as MonitorFields;
}

function firstDue(fields: MonitorFields, now: number): number | null {
  if (fields.paused) return null;
  if (fields.type === "heartbeat") return now + (fields.intervalSec + fields.config.graceSec) * 1000;
  return now;
}

// ---- incidents ----

function listIncidents(ws: Workspace, query: Record<string, string>): unknown[] {
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200);
  const monitorId = query.monitorId;
  const rows = ws.sql
    .exec<{ id: string; monitor_id: string; name: string | null; started_at: number; resolved_at: number | null; cause: string }>(
      `SELECT i.id, i.monitor_id, m.name, i.started_at, i.resolved_at, i.cause FROM incident i LEFT JOIN monitor m ON m.id = i.monitor_id
       ${monitorId ? "WHERE i.monitor_id = ?" : ""} ORDER BY i.started_at DESC LIMIT ?`,
      ...(monitorId ? [monitorId, limit] : [limit]),
    )
    .toArray();
  return rows.map((r) => ({
    id: r.id,
    monitorId: r.monitor_id,
    monitorName: r.name,
    startedAt: iso(r.started_at),
    resolvedAt: iso(r.resolved_at),
    cause: r.cause,
  }));
}

// ---- channels ----

type ChannelRow = { id: string; type: "webhook"; name: string; config: string; enabled: number; created_at: number };

function channelRow(ws: Workspace, id: string): ChannelRow | undefined {
  return ws.sql.exec<ChannelRow>("SELECT * FROM channel WHERE id = ?", id).toArray()[0];
}

function toChannel(row: ChannelRow): ChannelFields {
  return { type: row.type, name: row.name, enabled: row.enabled === 1, config: JSON.parse(row.config) };
}

function listChannels(ws: Workspace): unknown[] {
  return ws.sql
    .exec<ChannelRow>("SELECT * FROM channel ORDER BY created_at")
    .toArray()
    .map((row) => ({ id: row.id, ...redactChannel(toChannel(row)), createdAt: iso(row.created_at) }));
}

function createChannel(ws: Workspace, body: unknown): unknown {
  const channel = parseChannel(body);
  const id = newId();
  const now = Date.now();
  ws.sql.exec(
    "INSERT INTO channel (id, type, name, config, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id, channel.type, channel.name, JSON.stringify(channel.config), channel.enabled ? 1 : 0, now,
  );
  return { id, ...redactChannel(channel), createdAt: iso(now) };
}

function updateChannel(ws: Workspace, id: string, body: unknown): unknown {
  const row = found(channelRow(ws, id));
  const channel = parseChannel(body, toChannel(row));
  ws.sql.exec(
    "UPDATE channel SET name = ?, config = ?, enabled = ? WHERE id = ?",
    channel.name, JSON.stringify(channel.config), channel.enabled ? 1 : 0, id,
  );
  return { id, ...redactChannel(channel), createdAt: iso(row.created_at) };
}

// ---- helpers ----

function ok(body: unknown): ApiResponse {
  return { status: 200, body };
}

function found<T>(value: T | undefined): T {
  if (value === undefined) throw new NotFound();
  return value;
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

