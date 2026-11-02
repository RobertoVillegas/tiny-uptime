import { printable, type Protocol } from "./protocol";

/** Errors a Redis server sends to PING when it wants a password or refuses this client: it still answered. */
const REDIS_ERRORS = /^-(NOAUTH|WRONGPASS|ERR|DENIED)\b/;

export const redis: Protocol = {
  request: new TextEncoder().encode("PING\r\n"),
  complete: (reply) => reply.includes(0x0a),
  judge(reply) {
    const end = reply.indexOf(0x0a);
    const line = printable(reply.subarray(0, end === -1 ? undefined : end));
    if (line.startsWith("+PONG")) return { ok: true, detail: "PONG" };
    if (REDIS_ERRORS.test(line)) return { ok: true, detail: `Redis answered: ${line.slice(1)}` };
    return { ok: false, detail: line ? `unexpected reply: ${line}` : "connection closed without a reply" };
  },
};
