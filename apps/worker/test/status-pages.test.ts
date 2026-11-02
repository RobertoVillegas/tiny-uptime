import { runInDurableObject } from "cloudflare:test";
import { env as runtimeEnv, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/runtime/env";
import type { Workspace } from "../src/runtime/workspace-object";

const env = runtimeEnv as unknown as Env;
const BASE = "https://tiny.test";
let failing = new Set<string>();

beforeEach(() => {
  failing = new Set();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return new Response("ok", { status: failing.has(url) ? 500 : 200 });
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

async function workspace(slug = `ws-${crypto.randomUUID().slice(0, 8)}`) {
  const res = await exports.default.fetch(
    new Request(`${BASE}/api/admin/workspaces`, {
      method: "POST",
      headers: { authorization: "Bearer test-operator-token", "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme", slug }),
    }),
  );
  return (await res.json()) as { id: string; apiKey: string };
}

async function monitor(ws: { id: string; apiKey: string }, name: string) {
  const url = `https://${name.toLowerCase().replace(/\W/g, "")}.test/`;
  const res = await call("POST", "/api/v1/monitors", ws.apiKey, {
    type: "http",
    name,
    url,
    failureThreshold: 1,
    paused: true,
    headers: { authorization: "Bearer s3cret" },
  });
  await runInDurableObject(env.WORKSPACE.get(env.WORKSPACE.idFromName(ws.id)), (_: Workspace, state) => {
    state.storage.sql.exec("UPDATE monitor SET paused = 0, status = 'pending', next_at = 1 WHERE id = ?", res.body.id);
  });
  return { id: res.body.id as string, url };
}

async function tick(id: string) {
  await runInDurableObject(env.WORKSPACE.get(env.WORKSPACE.idFromName(id)), async (ws: Workspace, state) => {
    state.storage.sql.exec("UPDATE monitor SET next_at = 1 WHERE next_at IS NOT NULL");
    await ws.alarm();
  });
}

const slug = () => `page-${crypto.randomUUID().slice(0, 8)}`;

describe("status pages", () => {
  it("shows chosen monitors in groups, with incidents and only their public updates", async () => {
    const ws = await workspace();
    const api = await monitor(ws, "API");
    const site = await monitor(ws, "Website");
    await monitor(ws, "Hidden internal");
    const pageSlug = slug();
    const created = await call("POST", "/api/v1/status-pages", ws.apiKey, {
      title: "Acme status",
      slug: pageSlug,
      description: "Live status of Acme",
      components: [
        { monitorId: site.id, group: "Public" },
        { monitorId: api.id, group: "Developers" },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.url).toBe(`${BASE}/s/${pageSlug}`);

    failing.add(api.url);
    await tick(ws.id);
    const incident = (await call("GET", "/api/v1/incidents", ws.apiKey)).body[0];
    await call("POST", `/api/v1/incidents/${incident.id}/updates`, ws.apiKey, { status: "investigating", body: "Looking into API errors" });
    await call("POST", `/api/v1/incidents/${incident.id}/updates`, ws.apiKey, { body: "Pager rotation: ask Ana", visibility: "internal" });

    const page = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}`)).json()) as any;
    expect(page.overall).toBe("partial_outage");
    expect(page.groups.map((g: { name: string }) => g.name)).toEqual(["Public", "Developers"]);
    expect(page.groups[0].components[0].days).toHaveLength(90);
    expect(page.activeIncidents).toHaveLength(1);
    expect(page.activeIncidents[0].updates.map((u: { body: string }) => u.body)).toEqual(["Looking into API errors"]);

    const html = await (await exports.default.fetch(`${BASE}/s/${pageSlug}`)).text();
    expect(html).toContain("Acme status");
    expect(html).toContain("Partial outage");
    expect(html).toContain("Looking into API errors");
    expect(html).not.toContain("Hidden internal");
    expect(html).not.toContain("Pager rotation");
    expect(html).not.toContain("api.test");
    expect(html).not.toContain("s3cret");

    const rss = await exports.default.fetch(`${BASE}/s/${pageSlug}/rss`);
    expect(rss.headers.get("content-type")).toContain("application/rss+xml");
    expect(await rss.text()).toContain("<title>API: HTTP 500</title>");
  });

  it("keeps slugs and domains unique across workspaces, and frees them on delete", async () => {
    const a = await workspace();
    const b = await workspace();
    const taken = slug();
    const first = await call("POST", "/api/v1/status-pages", a.apiKey, { title: "A", slug: taken, customDomain: `${taken}.example.com` });
    expect(first.status).toBe(201);
    expect((await call("POST", "/api/v1/status-pages", b.apiKey, { title: "B", slug: taken })).body.field).toBe("slug");
    expect(
      (await call("POST", "/api/v1/status-pages", b.apiKey, { title: "B", slug: slug(), customDomain: `${taken}.example.com` })).body.field,
    ).toBe("customDomain");

    const byHost = await exports.default.fetch(`https://${taken}.example.com/`);
    expect(byHost.status).toBe(200);
    expect(await byHost.text()).toContain("<h1>A</h1>");

    expect((await call("DELETE", `/api/v1/status-pages/${first.body.id}`, a.apiKey)).status).toBe(204);
    expect((await call("POST", "/api/v1/status-pages", b.apiKey, { title: "B", slug: taken })).status).toBe(201);
  });

  it("validates its input and the monitors it shows", async () => {
    const ws = await workspace();
    expect((await call("POST", "/api/v1/status-pages", ws.apiKey, { title: "x", slug: "Bad Slug" })).body.field).toBe("slug");
    expect((await call("POST", "/api/v1/status-pages", ws.apiKey, { title: "x", slug: slug(), okPct: 90, warnPct: 95 })).body.field).toBe(
      "warnPct",
    );
    expect(
      (await call("POST", "/api/v1/status-pages", ws.apiKey, { title: "x", slug: slug(), components: [{ monitorId: "aaaaaaaaaaaa" }] }))
        .body.field,
    ).toBe("components");
  });

  it("still serves a workspace's legacy page of public monitors", async () => {
    const legacy = `legacy-${crypto.randomUUID().slice(0, 6)}`;
    const ws = await workspace(legacy);
    await call("POST", "/api/v1/monitors", ws.apiKey, {
      type: "http",
      name: "Public thing",
      url: "https://pub.test/",
      public: true,
      paused: true,
    });
    const html = await (await exports.default.fetch(`${BASE}/s/${legacy}`)).text();
    expect(html).toContain("Public thing");
  });
});
