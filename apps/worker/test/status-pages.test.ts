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

  it("shows the range a page opens with, or the one a visitor picks, hour by hour for a day", async () => {
    const ws = await workspace();
    const api = await monitor(ws, "API");
    const pageSlug = slug();
    const created = await call("POST", "/api/v1/status-pages", ws.apiKey, {
      title: "Ranges",
      slug: pageSlug,
      historyDays: 30,
      components: [{ monitorId: api.id }],
    });
    expect(created.body.historyDays).toBe(30);
    await tick(ws.id);

    const opens = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}`)).json()) as any;
    expect(opens.historyDays).toBe(30);
    expect(opens.groups[0].components[0].days).toHaveLength(30);

    const day = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}?days=1`)).json()) as any;
    expect(day.barSize).toBe("hour");
    expect(day.groups[0].components[0].days).toHaveLength(24);
    expect(day.groups[0].components[0].days.at(-1).checks).toBe(1);

    const odd = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}?days=1000`)).json()) as any;
    expect(odd.historyDays).toBe(30);

    const html = await (await exports.default.fetch(`${BASE}/s/${pageSlug}?days=7`)).text();
    expect(html).toContain(`href="/s/${pageSlug}?days=7" aria-current="page"`);
    expect(html).toContain(`href="/s/${pageSlug}">30 days</a>`);
    expect(html).toContain('href="https://github.com/RobertoVillegas/tiny-uptime"');

    expect((await call("POST", "/api/v1/status-pages", ws.apiKey, { title: "x", slug: slug(), historyDays: 60 })).body.field).toBe(
      "historyDays",
    );
  });

  it("speaks the page's language and shows times in its zone", async () => {
    const ws = await workspace();
    const api = await monitor(ws, "API");
    const pageSlug = slug();
    await call("POST", "/api/v1/status-pages", ws.apiKey, {
      title: "Estado",
      slug: pageSlug,
      language: "es",
      timeZone: "America/Mexico_City",
      components: [{ monitorId: api.id }],
    });
    failing.add(api.url);
    await tick(ws.id);
    const html = await (await exports.default.fetch(`${BASE}/s/${pageSlug}`)).text();
    expect(html).toContain('<html lang="es"');
    expect(html).toContain("Falla general");
    expect(html).toContain("Caído");
    expect(html).toContain("Incidentes anteriores");
    expect(html).toMatch(/Actualizado \d\d:\d\d GMT-6/);
    expect(html).not.toContain("UTC");

    expect(
      (await call("POST", "/api/v1/status-pages", ws.apiKey, { title: "x", slug: slug(), timeZone: "Mars/Olympus_Mons" })).body.field,
    ).toBe("timeZone");
  });

  it("cuts days at the page's midnight and shows times in the visitor's zone", async () => {
    const ws = await workspace();
    const api = await monitor(ws, "API");
    const pageSlug = slug();
    await call("POST", "/api/v1/status-pages", ws.apiKey, {
      title: "Estado",
      slug: pageSlug,
      language: "es",
      timeZone: "America/Mexico_City",
      historyDays: 7,
      components: [{ monitorId: api.id }],
    });
    // Mexico City has been UTC-6 all year since 2022.
    const SIX = 6 * 3_600_000;
    const midnight = Math.floor((Date.now() - SIX) / 86_400_000) * 86_400_000 + SIX;
    await runInDurableObject(env.WORKSPACE.get(env.WORKSPACE.idFromName(ws.id)), (_: Workspace, state) => {
      const insert =
        "INSERT INTO rollup (monitor_id, hour, checks, ok, ms_sum, ms_count, ms_min, ms_max) VALUES (?, ?, 1, ?, 0, 0, NULL, NULL)";
      state.storage.sql.exec(insert, api.id, midnight - 3_600_000, 0);
      state.storage.sql.exec(insert, api.id, midnight, 1);
    });
    const json = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}`)).json()) as any;
    const days = json.groups[0].components[0].days;
    expect(days).toHaveLength(7);
    expect(days.at(-1)).toEqual({ day: new Date(midnight - SIX).toISOString().slice(0, 10), checks: 1, uptime: 1 });
    expect(days.at(-2)).toMatchObject({ checks: 1, uptime: 0 });

    const local = await exports.default.fetch(`${BASE}/s/${pageSlug}`);
    expect(local.headers.get("cache-control")).toBe("private, max-age=30");
    const here = await local.text();
    expect(here).toMatch(/Actualizado \d\d:\d\d GMT-6/);
    expect(here).not.toContain("Cada barra es un día");

    const madrid = await (
      await exports.default.fetch(new Request(`${BASE}/s/${pageSlug}`, { cf: { timezone: "Europe/Madrid" } } as RequestInit))
    ).text();
    expect(madrid).toMatch(/Actualizado \d\d:\d\d CES?T/);
    expect(madrid).toContain("Cada barra es un día en hora GMT-6.");
  });

  it("resets a page's history without deleting it, and brings it back", async () => {
    const ws = await workspace();
    const api = await monitor(ws, "API");
    const pageSlug = slug();
    const created = await call("POST", "/api/v1/status-pages", ws.apiKey, {
      title: "Reset",
      slug: pageSlug,
      incidentDays: 90,
      components: [{ monitorId: api.id }],
    });
    const id = created.body.id as string;
    failing.add(api.url);
    await tick(ws.id);
    failing.clear();
    await tick(ws.id);
    await runInDurableObject(env.WORKSPACE.get(env.WORKSPACE.idFromName(ws.id)), (_: Workspace, state) => {
      const twoDaysAgo = Date.now() - 2 * 86_400_000;
      state.storage.sql.exec("UPDATE incident SET started_at = ?, resolved_at = ?", twoDaysAgo, twoDaysAgo + 60_000);
      state.storage.sql.exec("UPDATE rollup SET hour = ?", Math.floor(twoDaysAgo / 3_600_000) * 3_600_000);
      state.storage.sql.exec("UPDATE rollup_daily SET day = ?", Math.floor(twoDaysAgo / 86_400_000) * 86_400_000);
    });
    const before = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}?days=7`)).json()) as any;
    expect(before.pastIncidents).toHaveLength(1);
    expect(before.groups[0].components[0].uptime).toBe(0.5);

    const reset = await call("POST", `/api/v1/status-pages/${id}/history-reset`, ws.apiKey);
    expect(reset.status).toBe(200);
    expect(reset.body.historyResetAt).not.toBeNull();
    const after = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}?days=7`)).json()) as any;
    expect(after.pastIncidents).toHaveLength(0);
    expect(after.groups[0].components[0].uptime).toBeNull();
    expect(after.groups[0].components[0].days.every((d: { checks: number }) => d.checks === 0)).toBe(true);

    await tick(ws.id);
    const fresh = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}?days=7`)).json()) as any;
    expect(fresh.groups[0].components[0].uptime).toBe(1);
    expect(fresh.groups[0].components[0].days.at(-1).checks).toBe(1);

    const undone = await call("DELETE", `/api/v1/status-pages/${id}/history-reset`, ws.apiKey);
    expect(undone.body.historyResetAt).toBeNull();
    const back = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}?days=7`)).json()) as any;
    expect(back.pastIncidents).toHaveLength(1);
    expect(back.groups[0].components[0].uptime).toBeCloseTo(2 / 3);
  });

  it("opens a day's bar with the incidents that overlapped it, cut at the page's midnight", async () => {
    const ws = await workspace();
    const api = await monitor(ws, "API");
    const site = await monitor(ws, "Website");
    const hidden = await monitor(ws, "Hidden internal");
    const pageSlug = slug();
    const created = await call("POST", "/api/v1/status-pages", ws.apiKey, {
      title: "Days",
      slug: pageSlug,
      timeZone: "America/Mexico_City",
      historyDays: 7,
      incidentDays: 7,
      components: [{ monitorId: api.id }, { monitorId: site.id }],
    });
    for (const m of [api, site, hidden]) failing.add(m.url);
    await tick(ws.id);
    failing.clear();
    await tick(ws.id);

    // Mexico City has been UTC-6 all year since 2022. Two days ago there, an hour after midnight,
    // API and the hidden monitor failed; Website failed half an hour before that midnight, on the
    // same UTC date but the day before in Mexico City.
    const SIX = 6 * 3_600_000;
    const DAY = 86_400_000;
    const today = Math.floor((Date.now() - SIX) / DAY) * DAY + SIX;
    const start = today - 2 * DAY;
    const label = new Date(start - SIX).toISOString().slice(0, 10);
    const before = new Date(start - DAY - SIX).toISOString().slice(0, 10);
    await runInDurableObject(env.WORKSPACE.get(env.WORKSPACE.idFromName(ws.id)), (_: Workspace, state) => {
      const move = "UPDATE incident SET started_at = ?, resolved_at = ? WHERE monitor_id = ?";
      state.storage.sql.exec(move, start + 3_600_000, start + 3_900_000, api.id);
      state.storage.sql.exec(move, start + 3_600_000, start + 3_900_000, hidden.id);
      state.storage.sql.exec(move, start - 1_800_000, start - 600_000, site.id);
    });

    const plain = await (await exports.default.fetch(`${BASE}/s/${pageSlug}`)).text();
    expect(plain).toContain(`href="/s/${pageSlug}?day=${label}#selected"`);
    expect(plain).not.toContain('id="selected"');
    expect(plain).not.toContain('aria-current="date"');

    const json = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}?day=${label}`)).json()) as any;
    expect(json.selected.bar).toBe(label);
    expect(json.selected.from).toBe(new Date(start).toISOString());
    expect(json.selected.to).toBe(new Date(start + DAY).toISOString());
    expect(json.selected.incidents.map((i: { componentName: string }) => i.componentName)).toEqual(["API"]);
    const earlier = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}?day=${before}`)).json()) as any;
    expect(earlier.selected.incidents.map((i: { componentName: string }) => i.componentName)).toEqual(["Website"]);
    const outside = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}?day=1999-01-01`)).json()) as any;
    expect(outside.selected).toBeNull();

    const html = await (await exports.default.fetch(`${BASE}/s/${pageSlug}?days=30&day=${label}`)).text();
    expect(html).toContain(`href="/s/${pageSlug}?days=30&#38;day=${label}#selected" aria-label=`);
    const section = html.slice(html.indexOf('<section class="selected" id="selected"'), html.indexOf('<section class="history">'));
    expect(section).toContain("API: HTTP 500");
    expect(section).not.toContain("Website: HTTP 500");
    expect(section).not.toContain("Hidden internal");
    expect(section).toContain(`href="/s/${pageSlug}?days=30">Back to all incidents</a>`);
    expect(html.match(/aria-current="date"/g)).toHaveLength(2);

    const hours = await (await exports.default.fetch(`${BASE}/s/${pageSlug}?days=1`)).text();
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString().slice(0, 13);
    expect(hours).toContain(`href="/s/${pageSlug}?days=1&#38;hour=${hour}#selected"`);
    const now = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}?days=1&hour=${hour}`)).json()) as any;
    expect(now.selected).toMatchObject({ bar: `${hour}:00:00.000Z`, incidents: [] });
    const hourHtml = await (await exports.default.fetch(`${BASE}/s/${pageSlug}?days=1&hour=${hour}`)).text();
    expect(hourHtml).toContain('aria-current="time"');
    expect(hourHtml).toContain("No incidents in this hour.");

    await call("POST", `/api/v1/status-pages/${created.body.id}/history-reset`, ws.apiKey);
    const reset = (await (await exports.default.fetch(`${BASE}/api/public/${pageSlug}?day=${label}`)).json()) as any;
    expect(reset.selected.incidents).toEqual([]);
  });
});
