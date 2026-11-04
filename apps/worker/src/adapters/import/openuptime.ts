import { Result } from "better-result";
import { REGIONS, type Region } from "@tiny-uptime/contracts";
import type { workspace } from "@tiny-uptime/core";

/** The fields of an OpenUptime monitor this importer reads (its REST API's shape). */
type OpenUptimeMonitor = {
  id: string;
  name: string;
  type: string;
  target: string;
  method?: string;
  requestBody?: string | null;
  expectedStatus?: number;
  intervalSec?: number;
  timeoutMs?: number;
  failureThreshold?: number;
  recoveryThreshold?: number;
  paused?: boolean;
  keyword?: string | null;
  keywordMode?: string;
  jsonAssertions?: { path: string; op: string; value?: string }[];
  expectedLocation?: string | null;
  headers?: Record<string, string>;
  wsMessage?: string | null;
  dnsRecordType?: string;
  dnsExpectedValue?: string | null;
  dnsMatchMode?: string;
  domainExpiryWarnDays?: number;
  graceSec?: number;
  tags?: string[];
  slowThresholdMs?: number;
  slowAlertAfter?: number;
  dependsOnMonitorId?: string | null;
  regions?: string[];
  mcpConfig?: unknown;
};

const MASK = "••••••••";

/** OpenUptime's bundled probe regions, each as the nearest region here. */
const REGION_OF: Record<string, Region> = {
  "us-east": "enam",
  "us-west": "wnam",
  "eu-central": "weur",
  "ap-southeast": "apac",
  "ap-northeast": "apac",
};

/** The types OpenUptime checks from its regions; it checks the rest from its own location. */
const PROBED_TYPES = ["http", "tcp", "websocket", "mcp"];

const TAG = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,29}$/u;
const clamp = (n: number | undefined, min: number, max: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;

/** Reads every monitor of the API key's project. */
export async function fetchOpenUptimeMonitors(url: string, apiKey: string): Promise<Result<OpenUptimeMonitor[], string>> {
  let res: Response;
  try {
    res = await fetch(new URL("/api/monitors", url), {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Result.err("could not reach that OpenUptime");
  }
  if (res.status === 401 || res.status === 403) return Result.err("OpenUptime refused the API key");
  if (!res.ok) return Result.err(`OpenUptime answered HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as unknown;
  const list = Array.isArray(body) ? body : (body as { monitors?: unknown })?.monitors;
  if (!Array.isArray(list)) return Result.err("that does not look like OpenUptime's monitor list");
  return Result.ok(
    list.filter((m): m is OpenUptimeMonitor => typeof m === "object" && m !== null && typeof (m as OpenUptimeMonitor).type === "string"),
  );
}

/** Translates one OpenUptime monitor into tiny-uptime's API shape, noting what does not carry over. */
export function fromOpenUptime(m: OpenUptimeMonitor): workspace.ImportCandidate {
  const notes: string[] = [];
  const slow = m.slowThresholdMs && m.slowThresholdMs > 0 ? clamp(m.slowThresholdMs, 50, 60_000, 3000) : null;
  const tags = (m.tags ?? []).filter((t) => TAG.test(t)).slice(0, 10);
  if (tags.length !== (m.tags ?? []).length) notes.push("some tags were not valid here and were dropped");
  const regions = PROBED_TYPES.includes(m.type) ? regionsOf(m.regions ?? [], notes) : [];
  if ((m.intervalSec ?? 300) < 30) notes.push("checks every 30 seconds, the shortest interval here");

  const common = {
    id: m.id,
    name: m.name.slice(0, 100),
    intervalSec: clamp(m.intervalSec, 30, 86_400, 300),
    paused: m.paused ?? false,
    failureThreshold: clamp(m.failureThreshold, 1, 10, 2),
    recoveryThreshold: clamp(m.recoveryThreshold, 1, 10, 1),
    slowThresholdMs: slow,
    slowAlertAfter: clamp(m.slowAlertAfter, 0, 20, 0),
    tags,
    dependsOn: m.dependsOnMonitorId ?? null,
    regions,
  };
  const timeoutMs = clamp(m.timeoutMs, 1000, 30_000, 10_000);
  const headers = Object.fromEntries(Object.entries(m.headers ?? {}).filter(([, v]) => v !== MASK));
  if (Object.keys(headers).length !== Object.keys(m.headers ?? {}).length)
    notes.push("masked header values were left out; add them by hand");

  switch (m.type) {
    case "http": {
      const body = m.requestBody && m.requestBody !== MASK ? m.requestBody : undefined;
      if (m.requestBody === MASK) notes.push("the request body was masked and left out");
      if (m.expectedLocation) notes.push(`the expected redirect to ${m.expectedLocation} is not checked here`);
      return {
        notes,
        raw: {
          ...common,
          type: "http",
          url: m.target,
          method: (m.method ?? "GET").toUpperCase(),
          headers,
          ...(body !== undefined ? { body } : {}),
          expectedStatus: m.expectedStatus ? [m.expectedStatus] : [],
          ...(m.keyword ? { keyword: { value: m.keyword, mode: m.keywordMode === "absent" ? "absent" : "contains" } } : {}),
          ...(m.jsonAssertions?.length ? { jsonAssertions: m.jsonAssertions } : {}),
          timeoutMs,
        },
      };
    }
    case "tcp":
      return { notes, raw: { ...common, type: "tcp", ...hostPort(m.target), timeoutMs } };
    case "postgres":
    case "mysql":
    case "redis": {
      notes.push("checked by protocol handshake only; credentials in the connection URL are not used");
      return { notes, raw: { ...common, type: m.type, ...hostPort(m.target), timeoutMs } };
    }
    case "heartbeat":
      notes.push("imported paused: point its sender at the new heartbeat URL, then resume it");
      return { notes, raw: { ...common, type: "heartbeat", paused: true, graceSec: clamp(m.graceSec, 0, 86_400, 60) } };
    case "dns":
      return {
        notes,
        raw: {
          ...common,
          type: "dns",
          host: m.target,
          recordType: m.dnsRecordType ?? "A",
          ...(m.dnsExpectedValue
            ? { expected: { value: m.dnsExpectedValue, mode: m.dnsMatchMode === "contains" ? "contains" : "exact" } }
            : {}),
          timeoutMs,
        },
      };
    case "domain":
      return {
        notes,
        raw: {
          ...common,
          type: "domain",
          domain: m.target,
          warnDays: clamp(m.domainExpiryWarnDays, 1, 365, 30),
          intervalSec: Math.max(3600, common.intervalSec),
        },
      };
    case "websocket":
      if (m.keyword) notes.push("the expected reply text is not checked here; any reply counts");
      return {
        notes,
        raw: { ...common, type: "websocket", url: m.target, headers, ...(m.wsMessage ? { message: m.wsMessage } : {}), timeoutMs },
      };
    case "mcp":
      if (m.mcpConfig) notes.push("MCP auth and tool checks were not imported; add headers by hand if it needs them");
      return { notes, raw: { ...common, type: "mcp", url: m.target, timeoutMs } };
    case "evm":
    case "solana":
      return { notes, raw: { ...common, type: m.type, url: m.target, timeoutMs } };
    default:
      return { notes, raw: { ...common, type: m.type } };
  }
}

/**
 * OpenUptime's regions as regions here. `auto`, its own location, is where the workspace runs.
 * Regions of a self-hosted probe with ids of its own cannot be placed and are left out.
 */
function regionsOf(ids: string[], notes: string[]): Region[] {
  const named = ids.filter((id) => id !== "auto");
  const known = named.map((id) => REGION_OF[id] ?? (REGIONS as readonly string[]).find((r) => r === id));
  const unknown = named.filter((_, i) => !known[i]);
  if (unknown.length) notes.push(`not checked from ${unknown.join(", ")}: no matching region here`);
  const regions = REGIONS.filter((r) => known.includes(r));
  if (regions.length < named.length - unknown.length) notes.push(`${named.join(", ")} are checked from ${regions.join(", ")} here`);
  return regions;
}

/** `host:port`, a URL with a host and port, or `[ipv6]:port`. */
function hostPort(target: string): { host: string; port?: number } {
  try {
    if (target.includes("://")) {
      const url = new URL(target);
      return { host: url.hostname.replace(/^\[|\]$/g, ""), ...(url.port ? { port: Number(url.port) } : {}) };
    }
  } catch {
    return { host: target };
  }
  const match = /^\[?([^\]]+?)\]?:(\d+)$/.exec(target);
  return match ? { host: match[1]!, port: Number(match[2]) } : { host: target };
}
