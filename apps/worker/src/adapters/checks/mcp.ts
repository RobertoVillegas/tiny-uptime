import type { CheckOutcome, RpcTarget } from "@tiny-uptime/core";
import { callRpc, checkRpc, notifyRpc } from "./json-rpc";

/** A revision every current MCP server negotiates; the server answers with the one it speaks. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * Up when an MCP server over Streamable HTTP completes the handshake (initialize, then the
 * initialized notification) and lists its tools.
 */
export function checkMcp(target: RpcTarget): Promise<CheckOutcome> {
  return checkRpc(target, async (endpoint) => {
    const init = await callRpc(
      endpoint,
      "initialize",
      { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "tiny-uptime", version: "0.1" } },
      1,
    );
    const server = init.result as { protocolVersion?: unknown; serverInfo?: { name?: unknown; version?: unknown } } | null;
    if (!server || typeof server.protocolVersion !== "string") return { ok: false, detail: "initialize returned no protocol version" };

    const session = init.headers.get("mcp-session-id");
    const headers = {
      ...endpoint.headers,
      "mcp-protocol-version": server.protocolVersion,
      ...(session ? { "mcp-session-id": session } : {}),
    };
    const next = { ...endpoint, headers };
    const status = await notifyRpc(next, "notifications/initialized");
    if (status < 200 || status >= 300) return { ok: false, detail: `notifications/initialized returned HTTP ${status}` };

    const { result } = await callRpc(next, "tools/list", {}, 2);
    const tools = (result as { tools?: unknown } | null)?.tools;
    if (!Array.isArray(tools)) return { ok: false, detail: "tools/list returned no tool list" };
    return { ok: true, detail: `${nameOf(server.serverInfo)}, ${tools.length} ${tools.length === 1 ? "tool" : "tools"}` };
  });
}

function nameOf(info: { name?: unknown; version?: unknown } | undefined): string {
  const name = typeof info?.name === "string" ? info.name.slice(0, 80) : "MCP server";
  return typeof info?.version === "string" ? `${name} ${info.version.slice(0, 40)}` : name;
}
