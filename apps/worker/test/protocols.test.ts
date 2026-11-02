import { describe, expect, it } from "vitest";
import { rpcReply, sseData } from "../src/adapters/checks/protocols/json-rpc";
import { mysql } from "../src/adapters/checks/protocols/mysql";
import { postgres } from "../src/adapters/checks/protocols/postgres";
import { redis } from "../src/adapters/checks/protocols/redis";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)));

/** A MySQL packet: 3-byte little-endian length, sequence number, payload. */
const packet = (payload: Uint8Array) => bytes([payload.length & 0xff, payload.length >> 8, 0, 0], [...payload]);

describe("PostgreSQL probe", () => {
  it("sends an SSLRequest: length 8 and code 80877103", () => {
    const view = new DataView(postgres.request!.buffer);
    expect(postgres.request!.length).toBe(8);
    expect(view.getInt32(0)).toBe(8);
    expect(view.getInt32(4)).toBe(80_877_103);
  });

  it("accepts either one-byte answer and nothing else", () => {
    expect(postgres.complete(bytes())).toBe(false);
    expect(postgres.complete(bytes("S"))).toBe(true);
    expect(postgres.judge(bytes("S"))).toEqual({ ok: true, detail: "PostgreSQL, TLS available" });
    expect(postgres.judge(bytes("N"))).toEqual({ ok: true, detail: "PostgreSQL, TLS not offered" });
    expect(postgres.judge(bytes("HTTP/1.1 400"))).toEqual({ ok: false, detail: "not a PostgreSQL server (unexpected reply)" });
    expect(postgres.judge(bytes())).toEqual({ ok: false, detail: "connection closed without a reply" });
  });
});

describe("MySQL probe", () => {
  const handshake = packet(bytes([0x0a], "8.0.36", [0], [1, 0, 0, 0], "salt1234", [0]));

  it("waits for the server's handshake and reports its version", () => {
    expect(mysql.request).toBeNull();
    expect(mysql.complete(handshake.subarray(0, 8))).toBe(false);
    expect(mysql.complete(handshake)).toBe(true);
    expect(mysql.judge(handshake)).toEqual({ ok: true, detail: "MySQL 8.0.36" });
    const mariadb = packet(bytes([0x0a], "5.5.5-10.11.6-MariaDB", [0]));
    expect(mysql.judge(mariadb)).toEqual({ ok: true, detail: "MySQL 5.5.5-10.11.6-MariaDB" });
  });

  it("judges a handshake as soon as the version string ends, without the rest of the packet", () => {
    const head = bytes([200, 0, 0, 0, 0x0a], "8.4.0", [0]);
    expect(mysql.complete(head)).toBe(true);
    expect(mysql.judge(head)).toEqual({ ok: true, detail: "MySQL 8.4.0" });
  });

  it("reports an error packet and refuses other protocols", () => {
    const refused = packet(bytes([0xff, 0x6a, 0x04], "Host '203.0.113.9' is not allowed to connect to this MySQL server"));
    expect(mysql.judge(refused)).toEqual({
      ok: false,
      detail: "server refused the connection: Host '203.0.113.9' is not allowed to connect to this MySQL server",
    });
    expect(mysql.judge(packet(bytes([0x09], "old")))).toEqual({ ok: false, detail: "not a MySQL server (unexpected handshake)" });
    expect(mysql.judge(bytes([1, 0]))).toEqual({ ok: false, detail: "connection closed without a handshake" });
  });
});

describe("Redis probe", () => {
  it("sends an inline PING and accepts PONG", () => {
    expect(new TextDecoder().decode(redis.request!)).toBe("PING\r\n");
    expect(redis.complete(bytes("+PO"))).toBe(false);
    expect(redis.complete(bytes("+PONG\r\n"))).toBe(true);
    expect(redis.judge(bytes("+PONG\r\n"))).toEqual({ ok: true, detail: "PONG" });
  });

  it("counts an authentication error as a Redis server answering", () => {
    expect(redis.judge(bytes("-NOAUTH Authentication required.\r\n"))).toEqual({
      ok: true,
      detail: "Redis answered: NOAUTH Authentication required.",
    });
    expect(redis.judge(bytes("-ERR operation not permitted\r\n")).ok).toBe(true);
  });

  it("refuses anything else", () => {
    expect(redis.judge(bytes("SSH-2.0-OpenSSH_9.6\r\n"))).toEqual({ ok: false, detail: "unexpected reply: SSH-2.0-OpenSSH_9.6" });
    expect(redis.judge(bytes())).toEqual({ ok: false, detail: "connection closed without a reply" });
  });
});

describe("JSON-RPC replies", () => {
  it("takes the result or error of the request's id only", () => {
    expect(rpcReply({ jsonrpc: "2.0", id: 1, result: false }, 1)).toEqual({ result: false });
    expect(rpcReply({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "Node is behind by 42 slots" } }, 1)).toEqual({
      error: { code: -32005, message: "Node is behind by 42 slots" },
    });
    expect(rpcReply({ jsonrpc: "2.0", id: 2, result: "ok" }, 1)).toBeUndefined();
    expect(rpcReply({ jsonrpc: "2.0", method: "notifications/message" }, 1)).toBeUndefined();
    expect(rpcReply("ok", 1)).toBeUndefined();
  });

  it("reads complete server-sent events and leaves a partial one for later", () => {
    const stream = 'event: message\ndata: {"a":1}\n\n: comment\n\ndata: line one\r\ndata: line two\r\n\r\ndata: {"partial"';
    expect(sseData(stream)).toEqual(['{"a":1}', "line one\nline two"]);
  });
});
