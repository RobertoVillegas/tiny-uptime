import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://tiny.test";

async function workspace() {
  const res = await exports.default.fetch(
    new Request(`${BASE}/api/admin/workspaces`, {
      method: "POST",
      headers: { authorization: "Bearer test-operator-token", "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme", slug: `mcp-${crypto.randomUUID().slice(0, 8)}` }),
    }),
  );
  return (await res.json()) as { id: string; apiKey: string };
}

let next = 1;
async function rpc(key: string, method: string, params?: unknown, headers: Record<string, string> = {}) {
  const res = await exports.default.fetch(
    new Request(`${BASE}/api/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: next++, method, ...(params ? { params } : {}) }),
    }),
  );
  return { status: res.status, body: (await res.json()) as any };
}

const call = (key: string, name: string, args: unknown = {}) => rpc(key, "tools/call", { name, arguments: args });
const data = (r: { body: any }) => JSON.parse(r.body.result.content[0].text);

describe("MCP server", () => {
  it("initializes, lists tools and negotiates the protocol version", async () => {
    const ws = await workspace();
    const init = await rpc(ws.apiKey, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "1" },
    });
    expect(init.body.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "tiny-uptime" },
      capabilities: { tools: {} },
    });
    const unknown = await rpc(ws.apiKey, "initialize", { protocolVersion: "1999-01-01" });
    expect(unknown.body.result.protocolVersion).toBe("2026-07-28");

    const tools = (await rpc(ws.apiKey, "tools/list")).body.result.tools as { name: string; run?: unknown; annotations: object }[];
    expect(tools.map((t) => t.name)).toContain("create_monitor");
    expect(tools.every((t) => t.run === undefined && t.annotations)).toBe(true);
  });

  it("creates, changes, pauses and lists monitors through tools", async () => {
    const ws = await workspace();
    const created = await call(ws.apiKey, "create_monitor", { monitor: { type: "heartbeat", name: "Backups", paused: true } });
    expect(created.body.result.isError).toBeUndefined();
    const monitor = data(created);
    expect(monitor.heartbeatUrl).toContain(`${BASE}/`);

    const renamed = data(await call(ws.apiKey, "update_monitor", { id: monitor.id, changes: { name: "Nightly backups" } }));
    expect(renamed.name).toBe("Nightly backups");
    expect(data(await call(ws.apiKey, "resume_monitor", { id: monitor.id })).paused).toBe(false);
    const listed = await call(ws.apiKey, "list_monitors");
    expect(listed.body.result.structuredContent.items.map((m: { name: string }) => m.name)).toEqual(["Nightly backups"]);
    expect(data(await call(ws.apiKey, "delete_monitor", { id: monitor.id }))).toEqual({ deleted: true });
  });

  it("reports bad input and missing things as tool errors, not protocol errors", async () => {
    const ws = await workspace();
    const invalid = await call(ws.apiKey, "create_monitor", { monitor: { type: "http", name: "x", url: "nope" } });
    expect(invalid.body.result.isError).toBe(true);
    expect(invalid.body.result.content[0].text).toContain("url");
    const missing = await call(ws.apiKey, "get_monitor", { id: "aaaaaaaaaaaa" });
    expect(missing.body.result.isError).toBe(true);
    expect((await call(ws.apiKey, "no_such_tool")).body.error.code).toBe(-32602);
    expect((await rpc(ws.apiKey, "resources/list")).body.error.code).toBe(-32601);
  });

  it("answers notifications with 202 and refuses other origins, other methods and missing keys", async () => {
    const ws = await workspace();
    const note = await exports.default.fetch(
      new Request(`${BASE}/api/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${ws.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      }),
    );
    expect(note.status).toBe(202);
    expect((await rpc(ws.apiKey, "ping", undefined, { origin: "https://evil.test" })).status).toBe(403);
    expect((await exports.default.fetch(`${BASE}/api/mcp`)).status).toBe(405);
    expect((await rpc("", "ping")).status).toBe(401);

    const garbage = await exports.default.fetch(
      new Request(`${BASE}/api/mcp`, { method: "POST", headers: { authorization: `Bearer ${ws.apiKey}` }, body: "{" }),
    );
    expect(((await garbage.json()) as any).error.code).toBe(-32700);
  });
});
