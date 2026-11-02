import { printable, type Protocol } from "./protocol";

/** Bytes of a packet header: a 3-byte little-endian payload length and a sequence number. */
const HEADER = 4;

function payloadLength(reply: Uint8Array): number {
  return reply[0]! | (reply[1]! << 8) | (reply[2]! << 16);
}

/** The server speaks first: a handshake packet with protocol version 10 and a NUL-terminated version string. */
export const mysql: Protocol = {
  request: null,
  complete(reply) {
    if (reply.length <= HEADER) return false;
    if (reply.length >= HEADER + payloadLength(reply)) return true;
    return reply[HEADER] === 0x0a && reply.indexOf(0, HEADER + 1) !== -1;
  },
  judge(reply) {
    if (reply.length <= HEADER) return { ok: false, detail: "connection closed without a handshake" };
    const payload = reply.subarray(HEADER, HEADER + payloadLength(reply));
    if (payload[0] === 0x0a) {
      const end = payload.indexOf(0, 1);
      const version = printable(payload.subarray(1, end === -1 ? undefined : end), 100);
      return { ok: true, detail: version ? `MySQL ${version}` : "MySQL" };
    }
    // An error packet: 0xff, a 2-byte code, then the message (for example, a host that may not connect).
    if (payload[0] === 0xff) {
      return { ok: false, detail: `server refused the connection: ${printable(payload.subarray(3)) || "error packet"}` };
    }
    return { ok: false, detail: "not a MySQL server (unexpected handshake)" };
  },
};
