import type { Clock, Ids } from "@tiny-uptime/core";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export const systemClock: Clock = { now: () => Date.now() };

export const cryptoIds: Ids = {
  id(length = 12) {
    let out = "";
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) out += ALPHABET[byte & 31];
    return out;
  },
  secret(bytes) {
    return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
  },
  async hash(text) {
    return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
  },
  async hashBase64Url(text) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
    return btoa(String.fromCharCode(...digest))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  },
};

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
