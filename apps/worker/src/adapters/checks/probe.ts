import { connect } from "cloudflare:sockets";
import type { CheckOutcome, SocketTarget } from "@tiny-uptime/core";
import type { Protocol } from "./protocols/protocol";
import { errorText, withTimeout } from "./timeout";

/** No probe needs more than a handshake; a server that keeps talking is not read further. */
const MAX_REPLY_BYTES = 16 * 1024;

/** Connects, sends the protocol's request and judges the reply, all within the monitor's timeout. */
export async function checkProbe(target: SocketTarget, protocol: Protocol): Promise<CheckOutcome> {
  const started = Date.now();
  const socket = connect({ hostname: target.host, port: target.port });
  try {
    const reply = await withTimeout(exchange(socket, protocol), target.timeoutMs);
    return { ...protocol.judge(reply), latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, detail: errorText(error) };
  } finally {
    socket.close().catch(() => {});
  }
}

async function exchange(socket: Socket, protocol: Protocol): Promise<Uint8Array> {
  if (protocol.request) {
    const writer = socket.writable.getWriter();
    await writer.write(protocol.request);
    writer.releaseLock();
  }
  const reader = socket.readable.getReader();
  let reply = new Uint8Array(0);
  while (!protocol.complete(reply) && reply.length < MAX_REPLY_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    const next = new Uint8Array(reply.length + value.length);
    next.set(reply);
    next.set(value, reply.length);
    reply = next;
  }
  return reply;
}
