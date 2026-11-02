import { describe, expect, it } from "vitest";
import { errorText } from "../src/adapters/checks/timeout";

describe("check failure causes", () => {
  it("turns runtime errors into causes people can act on", () => {
    expect(errorText(new Error("internal error; reference = abc123"))).toBe("could not connect (DNS lookup or connection failed)");
    expect(errorText(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe("timed out");
    expect(errorText(new Error("timeout after 10000 ms"))).toBe("timeout after 10000 ms");
    expect(errorText(new Error("Connection refused"))).toBe("connection refused");
    expect(errorText(new Error("HTTP 503"))).toBe("HTTP 503");
  });
});
