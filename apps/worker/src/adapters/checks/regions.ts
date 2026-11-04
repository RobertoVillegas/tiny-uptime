import type { CheckOutcome, MonitorSpec, RegionalChecker } from "@tiny-uptime/core";
import type { Region } from "@tiny-uptime/contracts";
import type { Env } from "../../runtime/env";
import { withTimeout } from "./timeout";

/** Time a probe gets beyond the check's own timeout: waking up and the round trip from far away. */
const PROBE_GRACE_MS = 5_000;

/**
 * Checks through the `Probe` Durable Object of each region. A location hint is honoured only when
 * `get()` first creates the object, and only as best effort: Cloudflare places it in a data
 * center near the hint, where it then stays.
 */
export class DurableRegions implements RegionalChecker {
  constructor(private readonly probes: Env["PROBE"]) {}

  async check(region: Region, spec: MonitorSpec): Promise<CheckOutcome | null> {
    const probe = this.probes.get(this.probes.idFromName(region), { locationHint: region });
    const timeoutMs = "timeoutMs" in spec.config ? spec.config.timeoutMs : 10_000;
    try {
      return await withTimeout(probe.check({ type: spec.type, config: spec.config } as MonitorSpec), timeoutMs + PROBE_GRACE_MS);
    } catch {
      return null;
    }
  }
}
