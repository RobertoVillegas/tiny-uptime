import { connect } from "cloudflare:sockets";
import type { CheckOutcome, SocketTarget } from "@tiny-uptime/core";
import { errorText, withTimeout } from "./timeout";

/** Server List Ping: handshake (next state = status), status request, then read the JSON response. */
export async function checkMinecraft(target: SocketTarget): Promise<CheckOutcome> {
  const started = Date.now();
  const socket = connect({ hostname: target.host, port: target.port });
  try {
    const status = await withTimeout(ping(socket, target.host, target.port), target.timeoutMs);
    const online = status.players?.online ?? "?";
    return { ok: true, latencyMs: Date.now() - started, detail: `${status.version?.name ?? "unknown"}, ${online} online` };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, detail: errorText(error) };
  } finally {
    socket.close().catch(() => {});
  }
}

type ServerStatus = { version?: { name?: string }; players?: { online?: number } };

async function ping(socket: Socket, host: string, port: number): Promise<ServerStatus> {
  const hostBytes = new TextEncoder().encode(host);
  const handshake = concat(
    varInt(0x00),
    varInt(-1),
    varInt(hostBytes.length),
    hostBytes,
    new Uint8Array([port >> 8, port & 0xff]),
    varInt(1),
  );
  const writer = socket.writable.getWriter();
  await writer.write(concat(varInt(handshake.length), handshake, varInt(1), varInt(0x00)));
  writer.releaseLock();

  const reader = socket.readable.getReader();
  let buffer: Uint8Array = new Uint8Array(0);
  for (;;) {
    const frame = readVarInt(buffer, 0);
    if (frame && buffer.length >= frame.next + frame.value) {
      const id = readVarInt(buffer, frame.next);
      const size = id && readVarInt(buffer, id.next);
      if (!id || !size || id.value !== 0x00) throw new Error("unexpected status packet");
      const json = new TextDecoder().decode(buffer.subarray(size.next, size.next + size.value));
      return JSON.parse(json) as ServerStatus;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error("connection closed before status response");
    buffer = concat(buffer, value);
  }
}

function varInt(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return new Uint8Array(bytes);
}

function readVarInt(buffer: Uint8Array, offset: number): { value: number; next: number } | undefined {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buffer[offset + i];
    if (byte === undefined) return undefined;
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return { value, next: offset + i + 1 };
  }
  throw new Error("VarInt too long");
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
