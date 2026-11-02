import type { Protocol } from "./protocol";

/** SSLRequest: length 8, then the code 80877103. Every PostgreSQL server answers it before any login. */
const SSL_REQUEST = new Uint8Array([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);

export const postgres: Protocol = {
  request: SSL_REQUEST,
  complete: (reply) => reply.length >= 1,
  judge(reply) {
    switch (reply[0]) {
      case 0x53:
        return { ok: true, detail: "PostgreSQL, TLS available" };
      case 0x4e:
        return { ok: true, detail: "PostgreSQL, TLS not offered" };
      // Servers older than 7.0 answer SSLRequest with an ErrorResponse; that is still PostgreSQL.
      case 0x45:
        return { ok: true, detail: "PostgreSQL, answered with an error" };
      case undefined:
        return { ok: false, detail: "connection closed without a reply" };
      default:
        return { ok: false, detail: "not a PostgreSQL server (unexpected reply)" };
    }
  },
};
