import { runInDurableObject } from "cloudflare:test";
import { env as runtimeEnv, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/runtime/env";
import type { Workspace } from "../src/runtime/workspace-object";

const env = runtimeEnv as unknown as Env;

const BASE = "https://tiny.test";
const realFetch = globalThis.fetch;

type Outbound = { url: string; init?: RequestInit };
let outbound: Outbound[] = [];
/** Status the fake monitored site answers with, by URL. */
let siteStatus: Record<string, number> = {};

beforeEach(() => {
  outbound = [];
  siteStatus = {};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    outbound.push({ url, ...(init ? { init } : {}) });
    if (url.startsWith("https://hooks.test/")) return new Response("{}", { status: 200 });
    return new Response("hello world", { status: siteStatus[url] ?? 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

async function call(method: string, path: string, opts: { key?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await exports.default.fetch(
    new Request(`${BASE}${path}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function newWorkspace(slug = `ws-${crypto.randomUUID().slice(0, 8)}`) {
  const res = await call("POST", "/api/admin/workspaces", { token: "test-operator-token", body: { name: "Acme", slug } });
  expect(res.status).toBe(201);
  return res.body as { id: string; slug: string; apiKey: string };
}

function stub(id: string) {
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(id));
}

/** Makes every monitor and delivery due now and runs the alarm handler in place, as if time had passed. */
async function tick(id: string) {
  await runInDurableObject(stub(id), async (ws: Workspace, state) => {
    state.storage.sql.exec("UPDATE monitor SET next_at = 1 WHERE next_at IS NOT NULL");
    state.storage.sql.exec("UPDATE delivery SET next_at = 1");
    await ws.alarm();
  });
}

describe("operator", () => {
  it("rejects workspace creation without the operator token", async () => {
    expect((await call("POST", "/api/admin/workspaces", { body: { name: "x", slug: "x" } })).status).toBe(401);
    expect((await call("POST", "/api/admin/workspaces", { token: "wrong", body: { name: "x", slug: "x" } })).status).toBe(401);
  });

  it("creates a workspace with a working API key and refuses a taken slug", async () => {
    const ws = await newWorkspace("taken");
    expect(ws.apiKey).toMatch(/^tu_[a-z2-7]{12}_[0-9a-f]{48}$/);
    expect((await call("GET", "/api/v1/workspace", { key: ws.apiKey })).body).toEqual({ id: ws.id, name: "Acme" });
    const again = await call("POST", "/api/admin/workspaces", { token: "test-operator-token", body: { name: "B", slug: "taken" } });
    expect(again.status).toBe(409);
  });
});

describe("API keys", () => {
  it("refuses missing, malformed, unknown and deleted keys", async () => {
    const ws = await newWorkspace();
    expect((await call("GET", "/api/v1/monitors")).status).toBe(401);
    expect((await call("GET", "/api/v1/monitors", { key: "nope" })).status).toBe(401);
    const forged = ws.apiKey.replace(/.{6}$/, "000000");
    expect((await call("GET", "/api/v1/monitors", { key: forged })).status).toBe(401);
    // A key for a workspace that was never created must not create storage or authenticate.
    expect((await call("GET", "/api/v1/monitors", { key: `tu_aaaaaaaaaaaa_${"0".repeat(48)}` })).status).toBe(401);

    const created = await call("POST", "/api/v1/api-keys", { key: ws.apiKey, body: { name: "ci" } });
    expect(created.status).toBe(201);
    expect((await call("GET", "/api/v1/monitors", { key: created.body.key })).status).toBe(200);
    const listed = await call("GET", "/api/v1/api-keys", { key: ws.apiKey });
    expect(listed.body.map((k: { name: string }) => k.name)).toEqual(["initial", "ci"]);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.key);
    expect((await call("DELETE", `/api/v1/api-keys/${created.body.id}`, { key: ws.apiKey })).status).toBe(204);
    expect((await call("GET", "/api/v1/monitors", { key: created.body.key })).status).toBe(401);
  });

  it("keeps workspaces apart", async () => {
    const a = await newWorkspace();
    const b = await newWorkspace();
    const monitor = await call("POST", "/api/v1/monitors", { key: a.apiKey, body: { type: "http", name: "A", url: "https://a.test/" } });
    expect((await call("GET", `/api/v1/monitors/${monitor.body.id}`, { key: b.apiKey })).status).toBe(404);
    expect((await call("GET", "/api/v1/monitors", { key: b.apiKey })).body).toEqual([]);
  });
});

describe("monitors", () => {
  it("validates input and names the field", async () => {
    const { apiKey } = await newWorkspace();
    const bad = async (body: unknown) => (await call("POST", "/api/v1/monitors", { key: apiKey, body })).body.field;
    expect(await bad({ type: "nope", name: "x" })).toBe("type");
    expect(await bad({ type: "http", name: "x", url: "ftp://x" })).toBe("url");
    expect(await bad({ type: "http", name: "x", url: "https://x.test", body: "hi" })).toBe("body");
    expect(await bad({ type: "http", name: "x", url: "https://x.test", intervalSec: 5 })).toBe("intervalSec");
    expect(await bad({ type: "http", name: "x", url: "https://x.test", headers: { "bad name": "v" } })).toBe("headers.bad name");
    expect(await bad({ type: "tcp", name: "x", host: "not a host", port: 22 })).toBe("host");
    expect((await call("POST", "/api/v1/monitors", { key: apiKey, body: { type: "http" } })).status).toBe(400);
  });

  it("checks HTTP monitors, opens an incident after two failures and alerts in OpenUptime's format", async () => {
    const ws = await newWorkspace();
    const key = ws.apiKey;
    await call("POST", "/api/v1/channels", { key, body: { type: "webhook", name: "kukuroo", url: "https://hooks.test/secret-path" } });
    const created = await call("POST", "/api/v1/monitors", {
      key,
      body: { type: "http", name: "Site", url: "https://site.test/", expectedStatus: [200], keyword: { value: "hello" } },
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    await tick(ws.id);
    let monitor = (await call("GET", `/api/v1/monitors/${id}`, { key })).body;
    expect(monitor.status).toBe("up");
    expect(monitor.lastDetail).toBe("HTTP 200");
    expect(outbound.filter((o) => o.url.startsWith("https://hooks.test/"))).toHaveLength(0);

    siteStatus["https://site.test/"] = 503;
    await tick(ws.id);
    monitor = (await call("GET", `/api/v1/monitors/${id}`, { key })).body;
    expect(monitor.status).toBe("up"); // one failure is retried before alerting
    await tick(ws.id);
    monitor = (await call("GET", `/api/v1/monitors/${id}`, { key })).body;
    expect(monitor.status).toBe("down");

    const hooks = () => outbound.filter((o) => o.url === "https://hooks.test/secret-path").map((o) => JSON.parse(String(o.init?.body)));
    expect(hooks()).toHaveLength(1);
    const opened = hooks()[0];
    expect(opened).toMatchObject({
      kind: "incident.opened",
      incident: { title: "HTTP 503", resolvedAt: null },
      monitor: { name: "Site", target: "https://site.test/" },
    });

    siteStatus["https://site.test/"] = 200;
    await tick(ws.id);
    expect(hooks()).toHaveLength(2);
    expect(hooks()[1]).toMatchObject({ kind: "incident.resolved", incident: { id: opened.incident.id } });

    const incidents = (await call("GET", "/api/v1/incidents", { key })).body;
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ monitorId: id, cause: "HTTP 503" });
    expect(incidents[0].resolvedAt).not.toBeNull();

    const stats = (await call("GET", `/api/v1/monitors/${id}/stats?hours=24`, { key })).body;
    expect(stats.series.reduce((n: number, h: { checks: number }) => n + h.checks, 0)).toBe(4);
    const hour = stats.series.at(-1);
    expect(hour.minLatencyMs).toBeTypeOf("number");
    expect(hour.maxLatencyMs).toBeGreaterThanOrEqual(hour.minLatencyMs);

    const activity = (await call("GET", "/api/v1/monitors/activity", { key })).body;
    expect(activity.hours).toBe(24);
    expect(activity.monitors[id]).toEqual(stats.series);
  });

  it("fails a keyword check when the word is missing", async () => {
    const ws = await newWorkspace();
    const created = await call("POST", "/api/v1/monitors", {
      key: ws.apiKey,
      body: { type: "http", name: "Kw", url: "https://kw.test/", keyword: { value: "absent-word" } },
    });
    await tick(ws.id);
    const monitor = (await call("GET", `/api/v1/monitors/${created.body.id}`, { key: ws.apiKey })).body;
    expect(monitor.lastDetail).toBe("HTTP 200, keyword missing");
    expect(monitor.status).toBe("pending");
  });

  it("retries a failed alert delivery from the alarm", async () => {
    const ws = await newWorkspace();
    const key = ws.apiKey;
    await call("POST", "/api/v1/channels", { key, body: { type: "webhook", name: "flaky", url: "https://hooks.test/flaky" } });
    let failHook = true;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      outbound.push({ url });
      if (url === "https://hooks.test/flaky") return new Response("", { status: failHook ? 500 : 200 });
      return new Response("", { status: 503 });
    });
    await call("POST", "/api/v1/monitors", { key, body: { type: "http", name: "Down", url: "https://down.test/" } });
    await tick(ws.id);
    await tick(ws.id);
    const pending = await runInDurableObject(stub(ws.id), (_: Workspace, state) =>
      state.storage.sql.exec("SELECT attempts FROM delivery").toArray(),
    );
    expect(pending).toEqual([{ attempts: 1 }]);
    failHook = false;
    await tick(ws.id);
    const left = await runInDurableObject(stub(ws.id), (_: Workspace, state) => state.storage.sql.exec("SELECT * FROM delivery").toArray());
    expect(left).toEqual([]);
    expect(outbound.filter((o) => o.url === "https://hooks.test/flaky")).toHaveLength(2);
  });

  it("drops a check result when the monitor is paused while the check is in flight", async () => {
    const ws = await newWorkspace();
    const key = ws.apiKey;
    const id = (await call("POST", "/api/v1/monitors", { key, body: { type: "http", name: "Race", url: "https://race.test/" } })).body.id;
    vi.mocked(globalThis.fetch).mockImplementation(async () => {
      await call("PATCH", `/api/v1/monitors/${id}`, { key, body: { paused: true } });
      return new Response("", { status: 503 });
    });
    await tick(ws.id);
    await tick(ws.id);
    const monitor = (await call("GET", `/api/v1/monitors/${id}`, { key })).body;
    expect(monitor).toMatchObject({ status: "paused", lastCheckedAt: null });
    expect((await call("GET", "/api/v1/incidents", { key })).body).toEqual([]);
  });

  it("pauses without alerting and resumes as pending", async () => {
    const ws = await newWorkspace();
    const key = ws.apiKey;
    const id = (await call("POST", "/api/v1/monitors", { key, body: { type: "http", name: "P", url: "https://p.test/" } })).body.id;
    const paused = await call("PATCH", `/api/v1/monitors/${id}`, { key, body: { paused: true } });
    expect(paused.body).toMatchObject({ paused: true, status: "paused", nextCheckAt: null, url: "https://p.test/" });
    const resumed = await call("PATCH", `/api/v1/monitors/${id}`, { key, body: { paused: false, name: "P2" } });
    expect(resumed.body).toMatchObject({ paused: false, status: "pending", name: "P2" });
    expect((await call("PATCH", `/api/v1/monitors/${id}`, { key, body: { type: "tcp" } })).status).toBe(400);
    expect((await call("DELETE", `/api/v1/monitors/${id}`, { key })).status).toBe(204);
    expect((await call("GET", `/api/v1/monitors/${id}`, { key })).status).toBe(404);
  });
});

describe("heartbeats", () => {
  it("marks a heartbeat up on ping and down after interval plus grace", async () => {
    const ws = await newWorkspace();
    const key = ws.apiKey;
    const created = await call("POST", "/api/v1/monitors", {
      key,
      body: { type: "heartbeat", name: "Cron", intervalSec: 60, graceSec: 30 },
    });
    const url: string = created.body.heartbeatUrl;
    expect(url).toMatch(new RegExp(`^${BASE}/api/heartbeat/${ws.id}_[0-9a-f]{32}$`));
    const path = url.slice(BASE.length);

    expect((await exports.default.fetch(`${BASE}${path}`)).status).toBe(200);
    expect((await call("GET", `/api/v1/monitors/${created.body.id}`, { key })).body.status).toBe("up");
    expect((await exports.default.fetch(`${BASE}/api/heartbeat/${ws.id}_${"0".repeat(32)}`)).status).toBe(404);
    expect((await exports.default.fetch(`${BASE}/api/heartbeat/garbage`)).status).toBe(404);

    await tick(ws.id);
    expect((await call("GET", `/api/v1/monitors/${created.body.id}`, { key })).body).toMatchObject({
      status: "down",
      lastDetail: "no heartbeat received",
    });
  });
});

describe("public status page", () => {
  it("shows only public monitors and hides secrets", async () => {
    const ws = await newWorkspace("acme");
    const key = ws.apiKey;
    await call("POST", "/api/v1/monitors", { key, body: { type: "http", name: "Public site", url: "https://pub.test/", public: true } });
    await call("POST", "/api/v1/monitors", {
      key,
      body: { type: "http", name: "Private API", url: "https://private.test/", headers: { authorization: "Bearer s3cret" } },
    });
    await tick(ws.id);

    const page = await exports.default.fetch(`${BASE}/`);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("Public site");
    expect(html).not.toContain("Private API");
    expect(html).not.toContain("pub.test");

    const json = await (await exports.default.fetch(`${BASE}/api/public/acme`)).text();
    expect(json).toContain("Public site");
    expect(json).not.toContain("s3cret");
    expect((await exports.default.fetch(`${BASE}/s/missing`)).status).toBe(404);
  });
});
