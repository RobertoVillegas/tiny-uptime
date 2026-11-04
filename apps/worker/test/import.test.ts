import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

const BASE = "https://tiny.test";
afterEach(() => vi.restoreAllMocks());

async function workspace() {
  const res = await exports.default.fetch(
    new Request(`${BASE}/api/admin/workspaces`, {
      method: "POST",
      headers: { authorization: "Bearer test-operator-token", "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme", slug: `imp-${crypto.randomUUID().slice(0, 8)}` }),
    }),
  );
  return (await res.json()) as { id: string; apiKey: string };
}

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

const OPENUPTIME = [
  {
    id: "7c1f0000-0000-4000-8000-000000000001",
    name: "Site",
    type: "http",
    target: "https://site.example/",
    method: "GET",
    expectedStatus: 200,
    intervalSec: 300,
    timeoutMs: 10000,
    failureThreshold: 2,
    recoveryThreshold: 1,
    paused: false,
    keyword: "Welcome",
    keywordMode: "contains",
    headers: { authorization: "••••••••" },
    tags: ["publico"],
    slowThresholdMs: 3000,
    slowAlertAfter: 0,
    dependsOnMonitorId: null,
    regions: ["auto"],
  },
  {
    id: "7c1f0000-0000-4000-8000-000000000002",
    name: "Worker",
    type: "heartbeat",
    target: "",
    intervalSec: 120,
    graceSec: 60,
    failureThreshold: 1,
    paused: false,
    tags: ["interno"],
    slowThresholdMs: 1500,
    slowAlertAfter: 0,
    dependsOnMonitorId: "7c1f0000-0000-4000-8000-000000000001",
  },
  {
    id: "7c1f0000-0000-4000-8000-000000000003",
    name: "Game",
    type: "tcp",
    target: "game.example:25565",
    paused: true,
    tags: [],
    regions: ["us-east", "eu-central", "my-probe"],
  },
  { id: "7c1f0000-0000-4000-8000-000000000004", name: "Broken", type: "http", target: "not a url" },
];

describe("export and import", () => {
  it("exports a workspace and imports it into another, relinking dependencies and skipping duplicates", async () => {
    const from = await workspace();
    const parent = await call("POST", "/api/v1/monitors", from.apiKey, {
      type: "http",
      name: "API",
      url: "https://api.example/",
      paused: true,
      tags: ["core"],
    });
    await call("POST", "/api/v1/monitors", from.apiKey, {
      type: "http",
      name: "Docs",
      url: "https://docs.example/",
      paused: true,
      dependsOn: parent.body.id,
    });
    const exported = await call("GET", "/api/v1/monitors/export", from.apiKey);
    expect(exported.body).toMatchObject({ format: "tiny-uptime.monitors", version: 1 });
    expect(exported.body.monitors[0]).not.toHaveProperty("status");

    const to = await workspace();
    const preview = await call("POST", "/api/v1/monitors/import", to.apiKey, { monitors: exported.body.monitors, dryRun: true });
    expect(preview.body.rows.map((r: { status: string }) => r.status)).toEqual(["ready", "ready"]);
    expect((await call("GET", "/api/v1/monitors", to.apiKey)).body).toEqual([]);

    const imported = await call("POST", "/api/v1/monitors/import", to.apiKey, { monitors: exported.body.monitors });
    expect(imported.body).toMatchObject({ created: 2, duplicates: 0, invalid: 0 });
    const list = (await call("GET", "/api/v1/monitors", to.apiKey)).body as {
      id: string;
      name: string;
      dependsOn: string | null;
      tags: string[];
    }[];
    const api = list.find((m) => m.name === "API")!;
    expect(api.tags).toEqual(["core"]);
    expect(list.find((m) => m.name === "Docs")!.dependsOn).toBe(api.id);

    const again = await call("POST", "/api/v1/monitors/import", to.apiKey, { monitors: exported.body.monitors });
    expect(again.body).toMatchObject({ created: 0, duplicates: 2 });
  });

  it("copies monitors from OpenUptime, noting what does not carry over", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
      return Response.json(OPENUPTIME);
    });
    const ws = await workspace();
    const body = { url: "https://uptime.example", apiKey: "ou_secretsecret" };
    const preview = await call("POST", "/api/v1/monitors/import/openuptime", ws.apiKey, body);
    expect(seen[0]).toEqual({ url: "https://uptime.example/api/monitors", auth: "Bearer ou_secretsecret" });
    expect(preview.body.dryRun).toBe(true);
    expect(preview.body.rows.map((r: { status: string }) => r.status)).toEqual(["ready", "ready", "ready", "invalid"]);

    const done = await call("POST", "/api/v1/monitors/import/openuptime", ws.apiKey, { ...body, dryRun: false });
    expect(done.body).toMatchObject({ created: 3, invalid: 1 });
    expect(done.body.rows[0].notes).toContain("masked header values were left out; add them by hand");
    expect(done.body.rows[1].notes[0]).toContain("imported paused");

    const list = (await call("GET", "/api/v1/monitors", ws.apiKey)).body as Record<string, any>[];
    const byName = Object.fromEntries(list.map((m) => [m.name, m]));
    expect(byName.Site).toMatchObject({
      url: "https://site.example/",
      expectedStatus: [200],
      keyword: { value: "Welcome", mode: "contains" },
      headers: {},
      tags: ["publico"],
      slowThresholdMs: 3000,
      slowAlertAfter: 0,
      paused: false,
    });
    expect(byName.Worker).toMatchObject({ paused: true, graceSec: 60, intervalSec: 120, failureThreshold: 1, dependsOn: byName.Site.id });
    expect(byName.Game).toMatchObject({ type: "tcp", host: "game.example", port: 25565, paused: true, regions: ["enam", "weur"] });
    expect(byName.Site.regions).toEqual([]);
    expect(done.body.rows[2].notes).toContain("not checked from my-probe: no matching region here");
  });

  it("refuses private OpenUptime hosts and reports a refused key", async () => {
    const ws = await workspace();
    const local = await call("POST", "/api/v1/monitors/import/openuptime", ws.apiKey, {
      url: "https://127.0.0.1",
      apiKey: "ou_secretsecret",
    });
    expect(local.body.field).toBe("url");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 401 }));
    const refused = await call("POST", "/api/v1/monitors/import/openuptime", ws.apiKey, {
      url: "https://uptime.example",
      apiKey: "ou_wrongwrong",
    });
    expect(refused).toMatchObject({ status: 502, body: { error: "OpenUptime refused the API key" } });
  });
});
