import { runInDurableObject } from "cloudflare:test";
import { env as runtimeEnv, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/runtime/env";
import type { Workspace } from "../src/runtime/workspace-object";

const env = runtimeEnv as unknown as Env;
const BASE = "https://tiny.test";

type Handler = (request: Request) => Response | Promise<Response>;
/** What each fake endpoint answers, by URL without the query. */
let routes: Record<string, Handler> = {};
/** Every request sent, with its body read while still in the Durable Object that sent it. */
let requests: { url: string; headers: Headers; body: string }[] = [];

beforeEach(() => {
  routes = {};
  requests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, headers: request.headers, body: typeof init?.body === "string" ? init.body : "" });
    const url = new URL(request.url);
    const handler = routes[`${url.origin}${url.pathname}`];
    return handler ? handler(request) : new Response("not found", { status: 404 });
  });
});

afterEach(() => vi.restoreAllMocks());

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });

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

async function workspace() {
  const res = await exports.default.fetch(
    new Request(`${BASE}/api/admin/workspaces`, {
      method: "POST",
      headers: { authorization: "Bearer test-operator-token", "content-type": "application/json" },
      body: JSON.stringify({ name: "Types", slug: `types-${crypto.randomUUID().slice(0, 8)}` }),
    }),
  );
  return (await res.json()) as { id: string; apiKey: string };
}

const stub = (id: string) => env.WORKSPACE.get(env.WORKSPACE.idFromName(id));

/**
 * Creates a monitor, runs one check and returns the monitor as the API shows it. It is created paused
 * and switched on in storage, because an alarm scheduled for "now" would also fire on its own.
 */
async function checkOnce(input: Record<string, unknown>) {
  const ws = await workspace();
  const created = await call("POST", "/api/v1/monitors", ws.apiKey, { name: "Target", failureThreshold: 1, ...input, paused: true });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  await runInDurableObject(stub(ws.id), async (instance: Workspace, state) => {
    state.storage.sql.exec("UPDATE monitor SET paused = 0, status = 'pending', next_at = 1 WHERE id = ?", created.body.id);
    await instance.alarm();
  });
  return (await call("GET", `/api/v1/monitors/${created.body.id}`, ws.apiKey)).body;
}

const RESOLVER = "https://cloudflare-dns.com/dns-query";
const answer =
  (records: { name: string; type: number; data: string }[], status = 0) =>
  () =>
    json({ Status: status, Answer: records }, { headers: { "content-type": "application/dns-json" } });

describe("DNS monitors", () => {
  it("resolves over HTTPS and shows what it found", async () => {
    routes[RESOLVER] = answer([{ name: "example.com.", type: 1, data: "93.184.216.34" }]);
    const m = await checkOnce({ type: "dns", host: "Example.com" });
    expect(m).toMatchObject({ status: "up", lastDetail: "93.184.216.34", host: "example.com", recordType: "A" });
    const query = new URL(requests[0]!.url);
    expect(query.searchParams.get("name")).toBe("example.com");
    expect(query.searchParams.get("type")).toBe("A");
    expect(requests[0]!.headers.get("accept")).toBe("application/dns-json");
  });

  it("follows the CNAME chain and ignores records for other names", async () => {
    routes[RESOLVER] = answer([
      { name: "www.example.com.", type: 5, data: "edge.example.net." },
      { name: "edge.example.net.", type: 1, data: "203.0.113.7" },
      { name: "unrelated.test.", type: 1, data: "198.51.100.1" },
    ]);
    const m = await checkOnce({ type: "dns", host: "www.example.com", expected: { value: "198.51.100.1" } });
    expect(m).toMatchObject({ status: "down", lastDetail: "no match for 198.51.100.1; found 203.0.113.7" });
  });

  it("matches an expected value exactly or as a substring", async () => {
    routes[RESOLVER] = answer([{ name: "example.com.", type: 15, data: "10 Mail.Example.com." }]);
    expect(
      await checkOnce({ type: "dns", host: "example.com", recordType: "MX", expected: { value: "10 mail.example.com" } }),
    ).toMatchObject({
      status: "up",
      expected: { value: "10 mail.example.com", mode: "exact" },
    });
    routes[RESOLVER] = answer([{ name: "_dmarc.example.com.", type: 16, data: '"v=DMARC1; p=reject"' }]);
    const txt = await checkOnce({
      type: "dns",
      host: "_dmarc.example.com",
      recordType: "TXT",
      expected: { value: "p=reject", mode: "contains" },
    });
    expect(txt.status).toBe("up");
  });

  it("is down when the name does not exist or has no record of the type", async () => {
    routes[RESOLVER] = answer([], 3);
    expect(await checkOnce({ type: "dns", host: "missing.example.com" })).toMatchObject({
      status: "down",
      lastDetail: "name does not exist (NXDOMAIN)",
    });
    routes[RESOLVER] = answer([]);
    expect(await checkOnce({ type: "dns", host: "example.com", recordType: "AAAA" })).toMatchObject({
      status: "down",
      lastDetail: "no AAAA records",
    });
  });
});

const rdap = (domain: string, inDays: number) => () =>
  json({
    objectClassName: "domain",
    ldhName: domain.toUpperCase(),
    events: [
      { eventAction: "registration", eventDate: "2001-01-01T00:00:00Z" },
      { eventAction: "expiration", eventDate: new Date(Date.now() + inDays * 86_400_000 - 60_000).toISOString() },
    ],
  });

describe("domain expiry monitors", () => {
  it("checks daily by default and is up while the expiry is further than the warning", async () => {
    routes["https://rdap.org/domain/example.com"] = rdap("example.com", 100);
    const m = await checkOnce({ type: "domain", domain: "example.com" });
    expect(m).toMatchObject({ status: "up", intervalSec: 86_400, warnDays: 30, lastLatencyMs: null });
    expect(m.lastDetail).toMatch(/^expires in 100 days \(\d{4}-\d\d-\d\d\)$/);
  });

  it("is down within the warning period and once expired", async () => {
    routes["https://rdap.org/domain/example.com"] = rdap("example.com", 10);
    expect((await checkOnce({ type: "domain", domain: "example.com", warnDays: 14 })).lastDetail).toMatch(/^expires in 10 days/);
    routes["https://rdap.org/domain/example.com"] = rdap("example.com", -3);
    const expired = await checkOnce({ type: "domain", domain: "example.com" });
    expect(expired.status).toBe("down");
    expect(expired.lastDetail).toMatch(/^expired on \d{4}-\d\d-\d\d$/);
  });

  it("says when the registry does not know the domain, and refuses short intervals", async () => {
    expect((await checkOnce({ type: "domain", domain: "nope.example" })).lastDetail).toBe("the registry has no record of this domain");
    const ws = await workspace();
    const res = await call("POST", "/api/v1/monitors", ws.apiKey, { type: "domain", name: "D", domain: "example.com", intervalSec: 300 });
    expect(res).toMatchObject({ status: 400, body: { field: "intervalSec" } });
  });
});

/** A server that answers the upgrade and echoes what it receives. */
const echo = (): Response => {
  const [client, server] = Object.values(new WebSocketPair());
  server!.accept();
  server!.addEventListener("message", (event) => server!.send(`echo ${String(event.data)}`));
  return new Response(null, { status: 101, webSocket: client! });
};

describe("WebSocket monitors", () => {
  it("is up when the upgrade succeeds, and with a message once a reply comes back", async () => {
    routes["https://ws.example.com/live"] = echo;
    expect(await checkOnce({ type: "websocket", url: "wss://ws.example.com/live" })).toMatchObject({
      status: "up",
      lastDetail: "connected",
    });
    const upgrade = requests[0]!;
    expect(upgrade.headers.get("upgrade")).toBe("websocket");

    const m = await checkOnce({
      type: "websocket",
      url: "wss://ws.example.com/live",
      message: "ping",
      headers: { authorization: "Bearer t" },
    });
    expect(m).toMatchObject({ status: "up", lastDetail: "connected, 9 byte reply", message: "ping" });
    expect(requests.at(-1)!.headers.get("authorization")).toBe("Bearer t");
  });

  it("is down when the server does not upgrade", async () => {
    routes["https://ws.example.com/live"] = () => new Response("hello", { status: 200 });
    expect(await checkOnce({ type: "websocket", url: "wss://ws.example.com/live" })).toMatchObject({
      status: "down",
      lastDetail: "expected 101 Switching Protocols, got HTTP 200",
    });
  });

  it("only accepts ws and wss URLs", async () => {
    const ws = await workspace();
    const res = await call("POST", "/api/v1/monitors", ws.apiKey, { type: "websocket", name: "W", url: "https://ws.example.com/" });
    expect(res).toMatchObject({ status: 400, body: { field: "url" } });
  });
});

const MCP_URL = "https://mcp.example.com/mcp";
const sse = (message: unknown) =>
  new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, { headers: { "content-type": "text/event-stream" } });

/** An MCP server that answers initialize with JSON and tools/list as a stream. */
const server: Handler = async (request) => {
  if (request.headers.get("authorization") !== "Bearer secret") return new Response("unauthorized", { status: 401 });
  const message = (await request.json()) as { id?: number; method: string };
  if (message.method === "initialize") {
    return json(
      {
        jsonrpc: "2.0",
        id: message.id,
        result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "docs", version: "1.2.0" } },
      },
      { headers: { "mcp-session-id": "session-1" } },
    );
  }
  if (request.headers.get("mcp-session-id") !== "session-1") return new Response("no session", { status: 400 });
  if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
  return sse({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "search" }, { name: "fetch" }] } });
};

describe("MCP monitors", () => {
  it("initializes, then lists tools within the session", async () => {
    routes[MCP_URL] = server;
    const m = await checkOnce({ type: "mcp", url: MCP_URL, headers: { authorization: "Bearer secret" } });
    expect(m).toMatchObject({ status: "up", lastDetail: "docs 1.2.0, 2 tools" });
    const sent = requests.map((r) => JSON.parse(r.body) as { method: string; params?: { protocolVersion?: string } });
    expect(sent.map((s) => s.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(sent[0]!.params?.protocolVersion).toBe("2025-06-18");
    expect(requests[2]!.headers.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(requests[0]!.headers.get("accept")).toBe("application/json, text/event-stream");
  });

  it("is down when the server refuses the request", async () => {
    routes[MCP_URL] = server;
    expect(await checkOnce({ type: "mcp", url: MCP_URL })).toMatchObject({ status: "down", lastDetail: "initialize returned HTTP 401" });
  });
});

const node =
  (results: Record<string, unknown>): Handler =>
  async (request) => {
    const { id, method } = (await request.json()) as { id: number; method: string };
    const reply = results[method];
    return json(
      reply instanceof Error
        ? { jsonrpc: "2.0", id, error: { code: -32005, message: reply.message } }
        : { jsonrpc: "2.0", id, result: reply },
    );
  };

describe("blockchain node monitors", () => {
  it("checks an EVM node is synced and on the expected chain", async () => {
    routes["https://eth.example.com/"] = node({ eth_syncing: false, eth_chainId: "0x1" });
    expect(await checkOnce({ type: "evm", url: "https://eth.example.com/", chainId: 1 })).toMatchObject({
      status: "up",
      lastDetail: "synced, chain 1",
      chainId: 1,
    });
    expect(await checkOnce({ type: "evm", url: "https://eth.example.com/", chainId: 137 })).toMatchObject({
      status: "down",
      lastDetail: "on chain 1, expected 137",
    });
  });

  it("is down while an EVM node syncs", async () => {
    routes["https://eth.example.com/"] = node({ eth_syncing: { startingBlock: "0x0", currentBlock: "0x10", highestBlock: "0x20" } });
    expect(await checkOnce({ type: "evm", url: "https://eth.example.com/" })).toMatchObject({
      status: "down",
      lastDetail: "node is syncing (block 16 of 32)",
    });
  });

  it("asks a Solana node for its health", async () => {
    routes["https://sol.example.com/"] = node({ getHealth: "ok" });
    expect(await checkOnce({ type: "solana", url: "https://sol.example.com/" })).toMatchObject({ status: "up", lastDetail: "healthy" });
    routes["https://sol.example.com/"] = node({ getHealth: new Error("Node is behind by 42 slots") });
    expect(await checkOnce({ type: "solana", url: "https://sol.example.com/" })).toMatchObject({
      status: "down",
      lastDetail: "getHealth failed: Node is behind by 42 slots (code -32005)",
    });
  });
});

describe("database probes", () => {
  it("default to each server's usual port", async () => {
    const ws = await workspace();
    for (const [type, port] of [
      ["postgres", 5432],
      ["mysql", 3306],
      ["redis", 6379],
    ] as const) {
      const res = await call("POST", "/api/v1/monitors", ws.apiKey, { type, name: type, host: "db.example.com", paused: true });
      expect(res).toMatchObject({ status: 201, body: { type, host: "db.example.com", port, timeoutMs: 10_000 } });
    }
  });
});
