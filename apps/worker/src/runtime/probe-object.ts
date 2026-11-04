import { DurableObject } from "cloudflare:workers";
import type { CheckOutcome, MonitorSpec } from "@tiny-uptime/core";
import { checker } from "../adapters/checks/checker";
import type { Env } from "./env";

/**
 * Runs checks from one region for every workspace. There is one per region, named after it and
 * created with that region as its location hint. It keeps no state, so it is never billed while idle.
 */
export class Probe extends DurableObject<Env> {
  check(spec: MonitorSpec): Promise<CheckOutcome> {
    return checker.check(spec);
  }
}
