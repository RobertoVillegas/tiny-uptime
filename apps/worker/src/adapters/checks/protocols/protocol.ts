/** A request-and-reply exchange over a raw socket that tells whether the right kind of server answered. */
export type Protocol = {
  /** Sent once connected; null when the server speaks first. */
  request: Uint8Array | null;
  /** Whether enough of the reply has arrived to judge it. */
  complete(reply: Uint8Array): boolean;
  /** The verdict on the reply, which may be empty or cut short when the server closed early. */
  judge(reply: Uint8Array): { ok: boolean; detail: string };
};

/** A server's own words, made safe and short enough for a detail line. */
export function printable(bytes: Uint8Array, max = 200): string {
  return new TextDecoder()
    .decode(bytes)
    .replace(/[^\x20-\x7e]/g, "")
    .trim()
    .slice(0, max);
}
