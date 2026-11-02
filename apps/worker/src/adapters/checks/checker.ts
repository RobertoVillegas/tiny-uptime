import type { Checker, CheckOutcome, MonitorSpec } from "@tiny-uptime/core";
import { checkHttp } from "./http";
import { checkMinecraft } from "./minecraft";
import { checkTcp } from "./tcp";

/** Runs the check that matches a monitor's type. Heartbeats are never checked: they report in. */
export const checker: Checker = {
  check(spec: MonitorSpec): Promise<CheckOutcome> {
    switch (spec.type) {
      case "http":
        return checkHttp(spec.config);
      case "tcp":
        return checkTcp(spec.config);
      case "minecraft":
        return checkMinecraft(spec.config);
      case "heartbeat":
        return Promise.resolve({ ok: true, latencyMs: null, detail: "heartbeat" });
    }
  },
};
