import { runInDurableObject } from "cloudflare:test";
import { env as runtimeEnv, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/runtime/env";
import type { Workspace } from "../src/runtime/workspace-object";

const env = runtimeEnv as unknown as Env;
const BASE = "https://tiny.test";

/** What each fake site answers: a status and how long it takes. */
let sites: Record<string, { status: number; delayMs?: number }> = {};
let hooks: { url: string; body: any }[] = [];

beforeEach(() => {
  sites = {};
  hooks = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://hooks.test/")) {
      hooks.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response("{}");
    }
    const site = sites[url] ?? { status: 200 };
    if (site.delayMs) await new Promise((r) => setTimeout(r, site.delayMs));
    return new Response("ok", { status: site.status });
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
      body: JSON.stringify({ name: "Engine", slug: `eng-${crypto.randomUUID().slice(0, 8)}` }),
    }),
  );
  const ws = (await res.json()) as { id: string; apiKey: string };
  const channel = (await call("POST", "/api/v1/channels", ws.apiKey, { type: "webhook", name: "main", url: "https://hooks.test/main" }))
    .body;
  return { ...ws, channelId: channel.id as string };
}

function stub(id: string) {
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(id));
}

/** Runs the alarm as if `minutesLater` had passed: everything due, follow-ups included. */
async function tick(id: string, minutesLater = 0) {
  await runInDurableObject(stub(id), async (ws: Workspace, state) => {
    const shift = minutesLater * 60_000;
    state.storage.sql.exec("UPDATE monitor SET next_at = 1 WHERE next_at IS NOT NULL");
    state.storage.sql.exec("UPDATE delivery SET next_at = 1");
    if (shift) {
      state.storage.sql.exec("UPDATE incident SET started_at = started_at - ?, last_reminder_at = last_reminder_at - ?", shift, shift);
    }
    await ws.alarm();
  });
}

/**
 * Creates an HTTP monitor that only checks when `tick` runs. It is created paused and switched on
 * in storage, because an alarm scheduled for "now" would also fire on its own and run extra checks.
 */
async function http(key: string, name: string, extra: Record<string, unknown> = {}) {
  const url = `https://${name.toLowerCase().replace(/\W/g, "")}.test/`;
  const res = await call("POST", "/api/v1/monitors", key, { type: "http", name, url, ...extra, paused: true });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const workspaceId = key.split("_")[1]!;
  await runInDurableObject(stub(workspaceId), (_: Workspace, state) => {
    state.storage.sql.exec("UPDATE monitor SET paused = 0, status = 'pending', next_at = 1 WHERE id = ?", res.body.id);
  });
  return { id: res.body.id as string, url };
}

describe("thresholds", () => {
  it("waits for the configured failures and successes before alerting", async () => {
    const ws = await setup();
    const m = await http(ws.apiKey, "Strict", { failureThreshold: 3, recoveryThreshold: 2 });
    sites[m.url] = { status: 500 };
    await tick(ws.id);
    await tick(ws.id);
    expect((await call("GET", `/api/v1/monitors/${m.id}`, ws.apiKey)).body.status).toBe("pending");
    await tick(ws.id);
    expect((await call("GET", `/api/v1/monitors/${m.id}`, ws.apiKey)).body.status).toBe("down");
    expect(hooks.map((h) => h.body.kind)).toEqual(["incident.opened"]);

    sites[m.url] = { status: 200 };
    await tick(ws.id);
    expect((await call("GET", `/api/v1/monitors/${m.id}`, ws.apiKey)).body.status).toBe("down");
    await tick(ws.id);
    expect((await call("GET", `/api/v1/monitors/${m.id}`, ws.apiKey)).body.status).toBe("up");
    expect(hooks.map((h) => h.body.kind)).toEqual(["incident.opened", "incident.resolved"]);
  });
});

describe("slow responses", () => {
  it("marks the monitor slow and alerts with OpenUptime's slow flag", async () => {
    const ws = await setup();
    const m = await http(ws.apiKey, "Sluggish", { slowThresholdMs: 50, slowAlertAfter: 2 });
    sites[m.url] = { status: 200, delayMs: 80 };
    await tick(ws.id);
    expect((await call("GET", `/api/v1/monitors/${m.id}`, ws.apiKey)).body.status).toBe("degraded");
    expect(hooks).toEqual([]);
    await tick(ws.id);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.body).toMatchObject({ kind: "incident.opened", slow: true, monitor: { name: "Sluggish" } });

    sites[m.url] = { status: 200 };
    await tick(ws.id);
    expect(hooks[1]!.body).toMatchObject({ kind: "incident.resolved", slow: true });
    const incidents = (await call("GET", "/api/v1/incidents", ws.apiKey)).body;
    expect(incidents[0]).toMatchObject({ kind: "slow", resolvedAt: expect.any(String) });
  });
});

describe("dependencies, routing and maintenance", () => {
  it("records a dependent monitor's outage without alerting while its dependency is down", async () => {
    const ws = await setup();
    const parent = await http(ws.apiKey, "Database", { failureThreshold: 1 });
    const child = await http(ws.apiKey, "API", { failureThreshold: 1, dependsOn: parent.id });
    sites[parent.url] = { status: 500 };
    await tick(ws.id);
    sites[child.url] = { status: 500 };
    await tick(ws.id);
    expect(hooks.map((h) => h.body.monitor.name)).toEqual(["Database"]);
    const childIncident = (await call("GET", `/api/v1/incidents?monitorId=${child.id}`, ws.apiKey)).body[0];
    expect(childIncident).toMatchObject({ notified: false });

    sites[parent.url] = { status: 200 };
    sites[child.url] = { status: 200 };
    await tick(ws.id);
    expect(hooks.map((h) => `${h.body.monitor.name} ${h.body.kind}`)).toEqual(["Database incident.opened", "Database incident.resolved"]);
  });

  it("refuses unknown or circular references", async () => {
    const ws = await setup();
    const a = await http(ws.apiKey, "A");
    expect(
      (await call("POST", "/api/v1/monitors", ws.apiKey, { type: "http", name: "B", url: "https://b.test/", dependsOn: "aaaaaaaaaaaa" }))
        .body.field,
    ).toBe("dependsOn");
    expect(
      (await call("POST", "/api/v1/monitors", ws.apiKey, { type: "http", name: "C", url: "https://c.test/", channelIds: ["aaaaaaaaaaaa"] }))
        .body.field,
    ).toBe("channelIds");
    const b = await http(ws.apiKey, "B", { dependsOn: a.id });
    expect((await call("PATCH", `/api/v1/monitors/${a.id}`, ws.apiKey, { dependsOn: b.id })).body.field).toBe("dependsOn");
  });

  it("alerts only the channels a monitor names", async () => {
    const ws = await setup();
    const other = (await call("POST", "/api/v1/channels", ws.apiKey, { type: "webhook", name: "other", url: "https://hooks.test/other" }))
      .body;
    const m = await http(ws.apiKey, "Routed", { failureThreshold: 1, channelIds: [other.id] });
    sites[m.url] = { status: 500 };
    await tick(ws.id);
    expect(hooks.map((h) => h.url)).toEqual(["https://hooks.test/other"]);
  });

  it("opens no incident during maintenance, and filters monitors by tag", async () => {
    const ws = await setup();
    const covered = await http(ws.apiKey, "Covered", { failureThreshold: 1, tags: ["edge"] });
    await http(ws.apiKey, "Other", { tags: ["core"] });
    const now = Date.now();
    const window = await call("POST", "/api/v1/maintenance", ws.apiKey, {
      name: "Deploy",
      monitorIds: [covered.id],
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
    });
    expect(window.status).toBe(201);
    expect(window.body).toMatchObject({ active: true, finished: false });

    sites[covered.url] = { status: 500 };
    await tick(ws.id);
    expect((await call("GET", `/api/v1/monitors/${covered.id}`, ws.apiKey)).body.status).toBe("down");
    expect((await call("GET", "/api/v1/incidents", ws.apiKey)).body).toEqual([]);
    expect(hooks).toEqual([]);

    const tagged = (await call("GET", "/api/v1/monitors?tag=edge", ws.apiKey)).body;
    expect(tagged.map((m: { name: string }) => m.name)).toEqual(["Covered"]);
    const bad = await call("POST", "/api/v1/maintenance", ws.apiKey, {
      name: "x",
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now - 1).toISOString(),
    });
    expect(bad.body.field).toBe("endsAt");
  });
});

describe("reminders and escalation", () => {
  it("reminds until someone acknowledges, and escalates long outages", async () => {
    const ws = await setup();
    const pager = (await call("POST", "/api/v1/channels", ws.apiKey, { type: "webhook", name: "pager", url: "https://hooks.test/pager" }))
      .body;
    const policy = await call("PATCH", "/api/v1/alert-policy", ws.apiKey, {
      reminderEveryMinutes: 10,
      escalateAfterMinutes: 30,
      escalationChannelIds: [pager.id],
    });
    expect(policy.status).toBe(200);
    const m = await http(ws.apiKey, "Flaky", { failureThreshold: 1, channelIds: [ws.channelId] });
    sites[m.url] = { status: 500 };
    await tick(ws.id);
    expect(hooks.map((h) => h.body.kind)).toEqual(["incident.opened"]);

    await tick(ws.id, 11);
    expect(hooks.at(-1)!.body).toMatchObject({ kind: "incident.reminder", count: 1 });

    await tick(ws.id, 25);
    expect(hooks.filter((h) => h.url === "https://hooks.test/pager").map((h) => h.body.kind)).toEqual(["incident.escalated"]);

    const incident = (await call("GET", "/api/v1/incidents", ws.apiKey)).body[0];
    expect((await call("POST", `/api/v1/incidents/${incident.id}/acknowledge`, ws.apiKey)).status).toBe(200);
    const before = hooks.length;
    await tick(ws.id, 30);
    expect(hooks.length).toBe(before);
    expect((await call("GET", "/api/v1/incidents", ws.apiKey)).body[0].acknowledgedAt).not.toBeNull();
  });
});
