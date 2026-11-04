import { describe, expect, it } from "vitest";
import { voteOnRegions } from "../src/domain/monitor/regions";

const up = (latencyMs: number) => ({ ok: true, latencyMs, detail: "HTTP 200" });
const down = (detail: string) => ({ ok: false, latencyMs: 30, detail });

describe("voteOnRegions", () => {
  it("needs a strict majority of the answers to fail", () => {
    expect(
      voteOnRegions([
        { region: "weur", outcome: down("HTTP 503") },
        { region: "enam", outcome: up(80) },
      ]),
    ).toEqual({
      ok: true,
      latencyMs: 80,
      detail: "HTTP 200; HTTP 503 from weur",
    });
  });

  it("groups failures by cause and takes the median latency of the winning side", () => {
    const voted = voteOnRegions([
      { region: "weur", outcome: down("HTTP 503") },
      { region: "apac", outcome: down("timed out") },
      { region: "oc", outcome: down("HTTP 503") },
      { region: "enam", outcome: up(10) },
      { region: "wnam", outcome: null },
    ]);
    expect(voted).toEqual({
      ok: false,
      latencyMs: 30,
      detail: "HTTP 503 from weur, oc; timed out from apac; up from enam; no answer from wnam",
    });
  });

  it("has no verdict when no region answered", () => {
    expect(voteOnRegions([{ region: "weur", outcome: null }])).toBeNull();
  });
});
