import { runInDurableObject } from "cloudflare:test";
import { env as runtimeEnv, exports } from "cloudflare:workers";
import type { CheckOutcome, MonitorSpec } from "@tiny-uptime/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/runtime/env";
import { Probe } from "../src/runtime/probe-object";
import type { Workspace } from "../src/runtime/workspace-object";

const env = runtimeEnv as unknown as Env;
const BASE = "https://tiny.test";

/** What each region's probe sees: an HTTP status, or "unreachable" for a probe that throws. */
let seen: Record<string, number | "unreachable"> = {};
/** What a check from the workspace itself sees. */
let localStatus = 200;
let asked: string[] = [];

beforeEach(() => {
  seen = {};
  localStatus = 200;
  asked = [];
  vi.spyOn(Probe.prototype, "check").mockImplementation(async function (this: Probe, _spec: MonitorSpec): Promise<CheckOutcome> {
    const region = (this as unknown as { ctx: DurableObjectState }).ctx.id.name!;
    asked.push(region);
    const status = seen[region] ?? 200;
    if (status === "unreachable") throw new Error("probe unreachable");
    return { ok: status < 400, latencyMs: 40, detail: `HTTP ${status}` };
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://hooks.test/")) return new Response("{}");
    return new Response("ok", { status: localStatus });
  });
});

afterEach(() => vi.restoreAllMocks());

async function call(method: string, path: string, key: string, body?: unknown) {
  const res = await exports.default.fetch(
    new Request(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function setup() {
  const res = await exports.default.fetch(
    new Request(`${BASE}/api/admin/workspaces`, {
      method: "POST",
      headers: { authorization: "Bearer test-operator-token", "content-type": "application/json" },
      body: JSON.stringify({ name: "Regions", slug: `reg-${crypto.randomUUID().slice(0, 8)}` }),
    }),
  );
  return (await res.json()) as { id: string; apiKey: string };
}

const stub = (id: string) => env.WORKSPACE.get(env.WORKSPACE.idFromName(id));

async function tick(id: string) {
  await runInDurableObject(stub(id), async (ws: Workspace, state) => {
    state.storage.sql.exec("UPDATE monitor SET next_at = 1 WHERE next_at IS NOT NULL");
    await ws.alarm();
  });
}

/** An HTTP monitor that goes down on its first failed run, switched on in storage so only `tick` checks it. */
async function monitor(ws: { id: string; apiKey: string }, regions: string[]) {
  const res = await call("POST", "/api/v1/monitors", ws.apiKey, {
    type: "http",
    name: "Site",
    url: "https://site.test/",
    regions,
    failureThreshold: 1,
    paused: true,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await runInDurableObject(stub(ws.id), (_: Workspace, state) => {
    state.storage.sql.exec("UPDATE monitor SET paused = 0, status = 'pending', next_at = 1 WHERE id = ?", res.body.id);
  });
  return res.body.id as string;
}

const get = async (ws: { apiKey: string }, id: string) => (await call("GET", `/api/v1/monitors/${id}`, ws.apiKey)).body;

describe("multi-region checks", () => {
  it("is down when most regions fail, and says which", async () => {
    const ws = await setup();
    const id = await monitor(ws, ["weur", "apac", "enam"]);
    seen = { weur: 503, apac: 503, enam: 200 };
    await tick(ws.id);
    const m = await get(ws, id);
    expect(m.status).toBe("down");
    expect(m.regions).toEqual(["weur", "apac", "enam"]);
    expect(asked.toSorted()).toEqual(["apac", "enam", "weur"]);
    const incident = (await call("GET", "/api/v1/incidents", ws.apiKey)).body[0];
    expect(incident.cause).toBe("HTTP 503 from weur, apac; up from enam");
    const stats = (await call("GET", `/api/v1/monitors/${id}/stats?hours=1`, ws.apiKey)).body;
    expect(stats.series.reduce((n: number, h: { checks: number }) => n + h.checks, 0)).toBe(1);
  });

  it("stays up when only a minority fails", async () => {
    const ws = await setup();
    const id = await monitor(ws, ["weur", "apac", "enam"]);
    seen = { apac: 503 };
    await tick(ws.id);
    const m = await get(ws, id);
    expect(m.status).toBe("up");
    expect(m.lastDetail).toBe("HTTP 200; HTTP 503 from apac");
    expect((await call("GET", "/api/v1/incidents", ws.apiKey)).body).toEqual([]);
  });

  it("leaves a probe that does not answer out of the vote", async () => {
    const ws = await setup();
    const id = await monitor(ws, ["weur", "apac", "enam"]);
    // Counted as a failure, the unreachable probe would make two of three.
    seen = { weur: "unreachable", apac: 503, enam: 200 };
    await tick(ws.id);
    const m = await get(ws, id);
    expect(m.status).toBe("up");
    expect(m.lastDetail).toBe("HTTP 200; HTTP 503 from apac; no answer from weur");
  });

  it("checks from the workspace when no region answers", async () => {
    const ws = await setup();
    const id = await monitor(ws, ["weur", "apac"]);
    seen = { weur: "unreachable", apac: "unreachable" };
    localStatus = 502;
    await tick(ws.id);
    const m = await get(ws, id);
    expect(m.status).toBe("down");
    expect(m.lastDetail).toBe("HTTP 502; checked here, no region answered");
  });

  it("checks from the workspace alone without regions", async () => {
    const ws = await setup();
    const id = await monitor(ws, []);
    await tick(ws.id);
    expect((await get(ws, id)).status).toBe("up");
    expect(asked).toEqual([]);
  });

  it("rejects unknown or repeated regions, and regions on heartbeats", async () => {
    const ws = await setup();
    const base = { type: "http", name: "Site", url: "https://site.test/" };
    expect((await call("POST", "/api/v1/monitors", ws.apiKey, { ...base, regions: ["mars"] })).status).toBe(400);
    expect((await call("POST", "/api/v1/monitors", ws.apiKey, { ...base, regions: ["weur", "weur"] })).status).toBe(400);
    expect((await call("POST", "/api/v1/monitors", ws.apiKey, { type: "heartbeat", name: "Cron", regions: ["weur"] })).status).toBe(400);
  });
});
