import { describe, expect, it } from "vitest";
import { overallStatus } from "../src/domain/status-page";

describe("overallStatus", () => {
  it("names the worst thing first", () => {
    expect(overallStatus(["up", "up"], false)).toBe("operational");
    expect(overallStatus(["up", "degraded"], false)).toBe("degraded");
    expect(overallStatus(["up", "down"], false)).toBe("partial_outage");
    expect(overallStatus(["down", "down"], false)).toBe("major_outage");
  });

  it("shows maintenance unless something is down", () => {
    expect(overallStatus(["up", "degraded"], true)).toBe("maintenance");
    expect(overallStatus(["up", "down"], true)).toBe("partial_outage");
  });
});
