import type { Checker, CheckOutcome, MonitorSpec } from "@tiny-uptime/core";
import { checkEvm, checkSolana } from "./blockchain";
import { checkDns } from "./dns";
import { checkDomain } from "./domain";
import { checkHttp } from "./http";
import { checkMcp } from "./mcp";
import { checkMinecraft } from "./minecraft";
import { checkProbe } from "./probe";
import { mysql } from "./protocols/mysql";
import { postgres } from "./protocols/postgres";
import { redis } from "./protocols/redis";
import { checkTcp } from "./tcp";
import { checkWebSocket } from "./websocket";

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
      case "dns":
        return checkDns(spec.config);
      case "postgres":
        return checkProbe(spec.config, postgres);
      case "mysql":
        return checkProbe(spec.config, mysql);
      case "redis":
        return checkProbe(spec.config, redis);
      case "websocket":
        return checkWebSocket(spec.config);
      case "domain":
        return checkDomain(spec.config);
      case "mcp":
        return checkMcp(spec.config);
      case "evm":
        return checkEvm(spec.config);
      case "solana":
        return checkSolana(spec.config);
    }
  },
};
