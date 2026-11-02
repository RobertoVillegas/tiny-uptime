import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, STEP_SECONDS, totpAt, verifyTotp } from "../src/domain/auth/totp";

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 test vectors", async () => {
    const secret = new TextEncoder().encode("12345678901234567890");
    expect(await totpAt(secret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(await totpAt(secret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(await totpAt(secret, Math.floor(20000000000 / 30), 8)).toBe("65353130");
  });

  it("round-trips base32", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it("accepts a code once and allows one step of drift", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / STEP_SECONDS);
    const code = (s: number) => totpAt(base32Decode(secret), s);
    expect(await verifyTotp(secret, await code(step), now, null)).toBe(step);
    expect(await verifyTotp(secret, await code(step), now, step)).toBeNull();
    expect(await verifyTotp(secret, await code(step + 1), now, null)).toBe(step + 1);
    expect(await verifyTotp(secret, await code(step + 2), now, null)).toBeNull();
    expect(await verifyTotp(secret, "12345", now, null)).toBeNull();
  });
});
