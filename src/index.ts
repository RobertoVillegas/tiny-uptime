import { authStore, currentSession, handleAuth, sameOrigin } from "./auth/routes";
import { ROLES } from "./auth/store";
import type { Env } from "./env";
import { isWorkspaceId, newApiKey, newId, parseApiKey, parseHeartbeatToken, sha256Hex } from "./lib/ids";
import { asObject, InvalidInput, oneOf, str } from "./lib/validate";
import { renderStatusPage } from "./page";
import type { ApiRequest } from "./workspace/api";

export { AuthStore } from "./auth/store";
export { Directory } from "./directory";
export { Workspace } from "./workspace/workspace";

const MAX_BODY_BYTES = 64 * 1024;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Slug → workspace id, kept for the life of the isolate so status pages skip the directory. */
const slugCache = new Map<string, string>();

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      const beat = /^\/api\/heartbeat\/([^/]+)$/.exec(path);
      if (beat) return await heartbeat(request, env, beat[1]!);
      if (path.startsWith("/api/v1/")) return await api(request, env, url);
      if (path === "/api/admin/workspaces") return await adminWorkspaces(request, env);
      if (path === "/api/admin/invites") return await adminInvite(request, env, url);
      if (path.startsWith("/auth/")) return await handleAuth(request, env, url, () => readJson(request));

      const page = path === "/" ? env.PUBLIC_SLUG : /^\/s\/([^/]+)$/.exec(path)?.[1];
      if (page !== undefined && request.method === "GET") return await statusPage(env, page);
      const json = /^\/api\/public\/([^/]+)$/.exec(path)?.[1];
      if (json && request.method === "GET") return await publicStatus(env, json);
      return error(404, "not found");
    } catch (e) {
      if (e instanceof InvalidInput) return Response.json({ error: e.message, field: e.field }, { status: 400 });
      if (e instanceof BodyError) return error(e.status, e.message);
      throw e;
    }
  },
} satisfies ExportedHandler<Env>;

async function heartbeat(request: Request, env: Env, token: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "HEAD") return error(405, "method not allowed");
  const parsed = parseHeartbeatToken(token);
  if (!parsed) return error(404, "unknown heartbeat");
  const known = await workspace(env, parsed.workspaceId).heartbeat(token);
  return known ? Response.json({ ok: true }) : error(404, "unknown heartbeat");
}

/**
 * The REST API accepts an API key, or the panel's session cookie plus the workspace to act on in
 * `x-workspace-id`. Members are checked here; API keys are checked by the workspace itself.
 */
async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const key = bearer(request);
  let workspaceId: string;
  let principal: ApiRequest["principal"];
  if (key) {
    const parsed = parseApiKey(key);
    if (!parsed) return error(401, "malformed API key");
    workspaceId = parsed.workspaceId;
    principal = { kind: "key", keyHash: await sha256Hex(key) };
  } else {
    const session = await currentSession(request, env);
    if (!session || session.info.stage !== "full") return error(401, "sign in or send an API key");
    if (!sameOrigin(request, url)) return error(403, "cross-origin request refused");
    const requested = request.headers.get("x-workspace-id") ?? "";
    const membership = session.info.memberships.find((m) => m.workspaceId === requested);
    if (!membership) return error(404, "workspace not found");
    workspaceId = membership.workspaceId;
    principal = { kind: "member", userId: session.info.userId, role: membership.role };
  }
  const body = request.method === "GET" || request.method === "DELETE" ? undefined : await readJson(request);
  const res = await workspace(env, workspaceId).api({
    principal,
    method: request.method,
    path: url.pathname.slice("/api/v1".length),
    query: Object.fromEntries(url.searchParams),
    body,
    origin: url.origin,
  });
  if (res.json === null) return new Response(null, { status: res.status });
  return new Response(res.json, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** Lets the operator invite a workspace's first owner, who then signs up with a passkey. */
async function adminInvite(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await isOperator(request, env))) return error(401, "unauthorized");
  if (request.method !== "POST") return error(405, "method not allowed");
  const input = asObject(await readJson(request));
  const workspaceId = str(input, "workspaceId", { max: 12 });
  const email = str(input, "email", { max: 200, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ });
  const role = oneOf(input, "role", ROLES, "owner");
  const entry = (await env.DIRECTORY.get(env.DIRECTORY.idFromName("directory")).list()).find((w) => w.id === workspaceId);
  if (!entry) return error(404, "workspace not found");
  const token = await authStore(env).createInvite(email, entry.id, entry.name, role);
  return Response.json({ inviteUrl: `${url.origin}/app/invite?token=${token}`, email, role }, { status: 201 });
}

async function adminWorkspaces(request: Request, env: Env): Promise<Response> {
  if (!(await isOperator(request, env))) return error(401, "unauthorized");
  const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
  if (request.method === "GET") return Response.json(await directory.list());
  if (request.method !== "POST") return error(405, "method not allowed");

  const input = asObject(await readJson(request));
  const name = str(input, "name", { max: 100 });
  const slug = str(input, "slug", { max: 40, pattern: SLUG });
  const id = newId();
  const entry = await directory.register(id, name, slug);
  if ("error" in entry) return error(409, entry.error);
  const ws = workspace(env, id);
  await ws.init(id, name);
  const key = newApiKey(id);
  await ws.createApiKey("initial", key);
  return Response.json({ ...entry, apiKey: key }, { status: 201 });
}

async function statusPage(env: Env, slug: string): Promise<Response> {
  const snapshot = await publicSnapshot(env, slug);
  if (!snapshot) return error(404, "status page not found");
  return new Response(renderStatusPage(snapshot.name, snapshot.monitors, Date.now()), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=30" },
  });
}

async function publicStatus(env: Env, slug: string): Promise<Response> {
  const snapshot = await publicSnapshot(env, slug);
  if (!snapshot) return error(404, "status page not found");
  return Response.json(snapshot, { headers: { "cache-control": "public, max-age=30", "access-control-allow-origin": "*" } });
}

async function publicSnapshot(env: Env, slug: string) {
  if (!SLUG.test(slug)) return null;
  let id = slugCache.get(slug);
  if (!id) {
    id = (await env.DIRECTORY.get(env.DIRECTORY.idFromName("directory")).resolve(slug)) ?? undefined;
    if (!id) return null;
    slugCache.set(slug, id);
  }
  return workspace(env, id).snapshot();
}

function workspace(env: Env, id: string) {
  if (!isWorkspaceId(id)) throw new Error("invalid workspace id");
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(id));
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return request.headers.get("x-api-key");
}

async function isOperator(request: Request, env: Env): Promise<boolean> {
  const given = bearer(request);
  if (!env.ADMIN_TOKEN || !given) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(env.ADMIN_TOKEN)),
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

class BodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new BodyError(413, "body too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new BodyError(413, "body too large");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError(400, "body must be JSON");
  }
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
