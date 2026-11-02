import type { Tool, ToolContext } from "./tools";

/** Versions this server speaks; it answers with the client's version when it knows it, else the newest. */
export const PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"] as const;
const SERVER_INFO = { name: "tiny-uptime", title: "tiny-uptime", version: "0.1.0" };
const INSTRUCTIONS =
  "tiny-uptime monitors websites, APIs, ports and heartbeats for one workspace. Use list_monitors first to find ids. " +
  "Incidents open when a monitor fails its threshold; acknowledge them to stop reminders and post updates to tell people what is going on.";

type JsonRpcId = string | number;
type JsonRpcMessage = { jsonrpc: "2.0"; id?: JsonRpcId; method?: string; params?: Record<string, unknown> };
export type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId | null } & (
  | { result: unknown }
  | { error: { code: number; message: string } }
);

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/** Answers one JSON-RPC message. Notifications get no answer (the transport replies 202). */
export async function handleMessage(raw: unknown, tools: readonly Tool[], ctx: ToolContext): Promise<JsonRpcResponse | null> {
  if (!isMessage(raw)) return error(null, INVALID_REQUEST, "expected a single JSON-RPC 2.0 message");
  if (raw.id === undefined) return null;
  const id = raw.id;
  switch (raw.method) {
    case "initialize": {
      const requested = String(raw.params?.protocolVersion ?? "");
      const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: tools.map(({ run: _run, ...definition }) => definition) });
    case "tools/call": {
      const name = raw.params?.name;
      const tool = tools.find((t) => t.name === name);
      if (!tool) return error(id, INVALID_PARAMS, `unknown tool ${String(name)}`);
      const args = raw.params?.arguments ?? {};
      if (typeof args !== "object" || args === null || Array.isArray(args)) return error(id, INVALID_PARAMS, "arguments must be an object");
      return result(id, await tool.run(args as Record<string, unknown>, ctx));
    }
    default:
      return error(id, METHOD_NOT_FOUND, `method ${String(raw.method)} is not supported`);
  }
}

export function parseError(): JsonRpcResponse {
  return error(null, PARSE_ERROR, "body must be one JSON-RPC message");
}

function isMessage(value: unknown): value is JsonRpcMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const m = value as JsonRpcMessage;
  return m.jsonrpc === "2.0" && (m.method === undefined || typeof m.method === "string");
}

function result(id: JsonRpcId, value: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result: value };
}

function error(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
