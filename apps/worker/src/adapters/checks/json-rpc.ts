import type { CheckOutcome, RpcTarget } from "@tiny-uptime/core";
import { readText, USER_AGENT } from "./http";
import { rpcReply, sseData, type RpcReply } from "./protocols/json-rpc";
import { errorText, withTimeout } from "./timeout";

/** A reply larger than this is cut off and fails to parse rather than filling memory. */
const MAX_REPLY_BYTES = 1024 * 1024;

export type RpcEndpoint = { url: string; headers: Record<string, string>; signal: AbortSignal };

/** Runs a check made of JSON-RPC calls, every call within the monitor's one timeout. */
export async function checkRpc(
  target: RpcTarget,
  run: (endpoint: RpcEndpoint) => Promise<Omit<CheckOutcome, "latencyMs">>,
): Promise<CheckOutcome> {
  const started = Date.now();
  const endpoint = { url: target.url, headers: target.headers, signal: AbortSignal.timeout(target.timeoutMs) };
  try {
    return { ...(await withTimeout(run(endpoint), target.timeoutMs)), latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, detail: errorText(error) };
  }
}

/**
 * Sends one JSON-RPC request over HTTP and returns its result, read from a JSON body or, as MCP
 * servers may answer, from a server-sent event stream. Throws with a cause people can read.
 */
export async function callRpc(endpoint: RpcEndpoint, method: string, params: unknown, id: number) {
  const res = await post(endpoint, { jsonrpc: "2.0", id, method, params });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${method} returned HTTP ${res.status}`);
  }
  const reply = isEventStream(res) ? await fromEventStream(res, id) : rpcReply(parse(await readText(res, MAX_REPLY_BYTES)), id);
  if (!reply) throw new Error(`${method} returned no JSON-RPC reply`);
  if ("error" in reply) throw new Error(`${method} failed: ${reply.error.message} (code ${reply.error.code})`);
  return { result: reply.result, headers: res.headers };
}

/** Sends a JSON-RPC notification, which has no reply, and returns the HTTP status. */
export async function notifyRpc(endpoint: RpcEndpoint, method: string): Promise<number> {
  const res = await post(endpoint, { jsonrpc: "2.0", method });
  await res.body?.cancel();
  return res.status;
}

function post(endpoint: RpcEndpoint, message: unknown): Promise<Response> {
  const headers = new Headers({ "user-agent": USER_AGENT, ...endpoint.headers });
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json, text/event-stream");
  // A redirect could carry the request, and its auth headers, to another host.
  return fetch(endpoint.url, { method: "POST", headers, body: JSON.stringify(message), redirect: "manual", signal: endpoint.signal });
}

function isEventStream(res: Response): boolean {
  return res.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream") ?? false;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Reads events until the one replying to `id`; the stream may stay open after it, so it is cancelled. */
async function fromEventStream(res: Response, id: number): Promise<RpcReply | undefined> {
  if (!res.body) return undefined;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < MAX_REPLY_BYTES) {
      const { value, done } = await reader.read();
      text += done ? decoder.decode() : decoder.decode(value, { stream: true });
      for (const data of sseData(done ? `${text}\n\n` : text)) {
        const reply = rpcReply(parse(data), id);
        if (reply) return reply;
      }
      if (done) return undefined;
    }
    return undefined;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
