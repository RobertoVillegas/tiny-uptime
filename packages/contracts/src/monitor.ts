import * as v from "valibot";
import { parseJsonPath } from "./json-path";

export const MONITOR_TYPES = [
  "http",
  "tcp",
  "minecraft",
  "heartbeat",
  "dns",
  "postgres",
  "mysql",
  "redis",
  "websocket",
  "domain",
  "mcp",
  "evm",
  "solana",
] as const;
export const DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const;
export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
/** `degraded` is up but slower than the monitor's slow threshold. */
export const MONITOR_STATUSES = ["pending", "up", "degraded", "down", "paused"] as const;
export const LIMITS = { minIntervalSec: 30, maxIntervalSec: 86_400, maxHeaders: 20, maxBodyBytes: 16_384 } as const;

export type MonitorType = (typeof MONITOR_TYPES)[number];
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;

const int = (min: number, max: number) => v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
const name = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100));
const host = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.regex(HOSTNAME, "must be a hostname"));
const timeoutMs = v.optional(int(1000, 30_000), 10_000);

const TAG = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,29}$/u;
const id = v.pipe(v.string(), v.regex(/^[a-z2-7]{12}$/, "is not an id"));

const common = {
  name,
  intervalSec: v.optional(int(LIMITS.minIntervalSec, LIMITS.maxIntervalSec), 300),
  paused: v.optional(v.boolean(), false),
  public: v.optional(v.boolean(), false),
  /** Failed checks in a row before the monitor is down and an incident opens. */
  failureThreshold: v.optional(int(1, 10), 2),
  /** Successful checks in a row before a down monitor counts as recovered. */
  recoveryThreshold: v.optional(int(1, 10), 1),
  /** Responses slower than this mark the monitor degraded; null turns it off. */
  slowThresholdMs: v.optional(v.nullable(int(50, 60_000)), null),
  /** Slow checks in a row before a slow incident opens; 0 only marks the monitor degraded, without an incident. */
  slowAlertAfter: v.optional(int(0, 20), 3),
  tags: v.optional(
    v.pipe(v.array(v.pipe(v.string(), v.trim(), v.regex(TAG, "must be up to 30 letters, digits, spaces or - _ ."))), v.maxLength(10)),
    [],
  ),
  /** While this monitor is down, this one does not alert: its outage is probably the same. */
  dependsOn: v.optional(v.nullable(id), null),
  /** Channels this monitor alerts; empty means every enabled channel. */
  channelIds: v.optional(v.pipe(v.array(id), v.maxLength(20)), []),
};

/** The settings every monitor type shares, beyond its target. */
export const MONITOR_OPTION_KEYS = [
  "failureThreshold",
  "recoveryThreshold",
  "slowThresholdMs",
  "slowAlertAfter",
  "tags",
  "dependsOn",
  "channelIds",
] as const;

const urlOf = (schemes: RegExp, message: string) =>
  v.pipe(
    v.string(),
    v.trim(),
    v.url(),
    v.check((value) => schemes.test(value), message),
    v.transform((value) => new URL(value).toString()),
  );
const httpUrl = urlOf(/^https?:\/\//i, "must be an http or https URL");

const headers = v.optional(
  v.pipe(
    v.record(
      v.pipe(v.string(), v.regex(HEADER_NAME, "is not a valid header name")),
      v.pipe(v.string(), v.maxLength(1024), v.regex(/^[^\r\n]*$/, "must be one line")),
    ),
    v.check((h) => Object.keys(h).length <= LIMITS.maxHeaders, `must have at most ${LIMITS.maxHeaders} entries`),
  ),
  {},
);

/** Comparisons a JSON assertion can make; the names match OpenUptime's, so imports carry them over. */
export const JSON_ASSERT_OPS = ["equals", "not_equals", "contains", "exists", "not_exists", "greater_than", "less_than"] as const;
export type JsonAssertOp = (typeof JSON_ASSERT_OPS)[number];
export const MAX_JSON_ASSERTIONS = 10;

const JsonAssertion = v.object({
  path: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1),
    v.maxLength(256),
    v.rawCheck(({ dataset, addIssue }) => {
      if (!dataset.typed) return;
      const parsed = parseJsonPath(dataset.value);
      if (typeof parsed === "string") addIssue({ message: parsed });
    }),
  ),
  op: v.picklist(JSON_ASSERT_OPS),
  value: v.optional(v.pipe(v.string(), v.maxLength(500)), ""),
});
export type JsonAssertion = v.InferOutput<typeof JsonAssertion>;

const HttpMonitor = v.pipe(
  v.object({
    type: v.literal("http"),
    ...common,
    url: httpUrl,
    method: v.optional(v.picklist(HTTP_METHODS), "GET"),
    headers,
    body: v.optional(
      v.pipe(
        v.string(),
        v.check((b) => new TextEncoder().encode(b).length <= LIMITS.maxBodyBytes, `must be at most ${LIMITS.maxBodyBytes} bytes`),
      ),
    ),
    /** Status codes that count as up; empty means any status below 400. */
    expectedStatus: v.optional(v.pipe(v.array(int(100, 599)), v.maxLength(20)), []),
    keyword: v.optional(
      v.object({
        value: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
        mode: v.optional(v.picklist(["contains", "absent"]), "contains"),
      }),
    ),
    /** Fields of a JSON body that must hold; any failing one fails the check. */
    jsonAssertions: v.optional(v.pipe(v.array(JsonAssertion), v.maxLength(MAX_JSON_ASSERTIONS)), []),
    timeoutMs,
  }),
  v.forward(
    v.check((m) => m.body === undefined || (m.method !== "GET" && m.method !== "HEAD"), "is not allowed with GET or HEAD"),
    ["body"],
  ),
);

const TcpMonitor = v.object({ type: v.literal("tcp"), ...common, host, port: int(1, 65_535), timeoutMs });
const MinecraftMonitor = v.object({ type: v.literal("minecraft"), ...common, host, port: v.optional(int(1, 65_535), 25_565), timeoutMs });
const HeartbeatMonitor = v.object({ type: v.literal("heartbeat"), ...common, graceSec: v.optional(int(0, 86_400), 60) });

/** DNS names may hold labels that are not hostnames, such as _dmarc or a leading wildcard. */
const DNS_NAME = /^(?=.{1,253}$)(\*\.)?([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?\.)*[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?\.?$/i;
const DnsMonitor = v.object({
  type: v.literal("dns"),
  ...common,
  host: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.regex(DNS_NAME, "must be a DNS name")),
  recordType: v.optional(v.picklist(DNS_RECORD_TYPES), "A"),
  /** An answer that must be among the records; without it any record of the type will do. */
  expected: v.optional(
    v.object({
      value: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500)),
      mode: v.optional(v.picklist(["exact", "contains"]), "exact"),
    }),
  ),
  timeoutMs,
});

/** Database and cache probes prove the server answers its protocol; they never log in. */
const probe = <T extends "postgres" | "mysql" | "redis">(type: T, port: number) =>
  v.object({ type: v.literal(type), ...common, host, port: v.optional(int(1, 65_535), port), timeoutMs });
const PostgresMonitor = probe("postgres", 5432);
const MysqlMonitor = probe("mysql", 3306);
const RedisMonitor = probe("redis", 6379);

const WebSocketMonitor = v.object({
  type: v.literal("websocket"),
  ...common,
  url: urlOf(/^wss?:\/\//i, "must be a ws or wss URL"),
  headers,
  /** Sent once the connection opens; some message must then come back. */
  message: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(2000))),
  timeoutMs,
});

const DomainMonitor = v.object({
  type: v.literal("domain"),
  ...common,
  /** Registration dates change rarely and RDAP servers rate limit, so checks are hourly at most. */
  intervalSec: v.optional(int(3600, LIMITS.maxIntervalSec), 86_400),
  domain: host,
  /** Down when the registration expires within this many days. */
  warnDays: v.optional(int(1, 365), 30),
  timeoutMs,
});

const rpc = { ...common, url: httpUrl, headers, timeoutMs };
const McpMonitor = v.object({ type: v.literal("mcp"), ...rpc });
const EvmMonitor = v.object({
  type: v.literal("evm"),
  ...rpc,
  /** The chain the node must be on, as eth_chainId reports it. */
  chainId: v.optional(int(1, Number.MAX_SAFE_INTEGER)),
});
const SolanaMonitor = v.object({ type: v.literal("solana"), ...rpc });

/** A monitor as clients send it: flat, with the fields of its type. */
export const MonitorInput = v.variant("type", [
  HttpMonitor,
  TcpMonitor,
  MinecraftMonitor,
  HeartbeatMonitor,
  DnsMonitor,
  PostgresMonitor,
  MysqlMonitor,
  RedisMonitor,
  WebSocketMonitor,
  DomainMonitor,
  McpMonitor,
  EvmMonitor,
  SolanaMonitor,
]);
export type MonitorInput = v.InferOutput<typeof MonitorInput>;
/** What a client may send: fields with defaults are optional. */
export type MonitorDraft = v.InferInput<typeof MonitorInput>;

/** Fields to change on an existing monitor; the rest keep their value. The type cannot change. */
export const MonitorPatch = v.looseObject({ type: v.optional(v.picklist(MONITOR_TYPES)) });
export type MonitorPatch = Record<string, unknown>;

export type Monitor = MonitorInput & {
  id: string;
  status: MonitorStatus;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastDetail: string | null;
  statusChangedAt: string;
  nextCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
  heartbeatUrl?: string;
};

/** Hours of history a stats request may ask for: up to 90 days. */
export const MAX_STATS_HOURS = 24 * 90;

/** What one check found, from `POST /monitors/:id/check`, with the monitor as it is afterwards. */
export type CheckResult = { ok: boolean; latencyMs: number | null; detail: string; monitor: Monitor };

/** The last `hours` hours of every monitor, keyed by monitor id, for the monitors list. */
export type MonitorsActivity = { hours: number; monitors: Record<string, MonitorStats["series"]> };

export type MonitorStats = {
  hours: number;
  uptime: number | null;
  avgLatencyMs: number | null;
  series: {
    hour: string;
    checks: number;
    ok: number;
    avgLatencyMs: number | null;
    minLatencyMs: number | null;
    maxLatencyMs: number | null;
  }[];
};
