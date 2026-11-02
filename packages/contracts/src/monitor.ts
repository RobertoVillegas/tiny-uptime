import * as v from "valibot";

export const MONITOR_TYPES = ["http", "tcp", "minecraft", "heartbeat"] as const;
export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
export const MONITOR_STATUSES = ["pending", "up", "down", "paused"] as const;
export const LIMITS = { minIntervalSec: 30, maxIntervalSec: 86_400, maxHeaders: 20, maxBodyBytes: 16_384 } as const;

export type MonitorType = (typeof MONITOR_TYPES)[number];
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;

const int = (min: number, max: number) => v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
const name = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100));
const host = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.regex(HOSTNAME, "must be a hostname"));
const timeoutMs = v.optional(int(1000, 30_000), 10_000);

const common = {
  name,
  intervalSec: v.optional(int(LIMITS.minIntervalSec, LIMITS.maxIntervalSec), 300),
  paused: v.optional(v.boolean(), false),
  public: v.optional(v.boolean(), false),
};

const httpUrl = v.pipe(
  v.string(),
  v.trim(),
  v.url(),
  v.check((value) => /^https?:\/\//i.test(value), "must be an http or https URL"),
  v.transform((value) => new URL(value).toString()),
);

const HttpMonitor = v.pipe(
  v.object({
    type: v.literal("http"),
    ...common,
    url: httpUrl,
    method: v.optional(v.picklist(HTTP_METHODS), "GET"),
    headers: v.optional(
      v.pipe(
        v.record(
          v.pipe(v.string(), v.regex(HEADER_NAME, "is not a valid header name")),
          v.pipe(v.string(), v.maxLength(1024), v.regex(/^[^\r\n]*$/, "must be one line")),
        ),
        v.check((h) => Object.keys(h).length <= LIMITS.maxHeaders, `must have at most ${LIMITS.maxHeaders} entries`),
      ),
      {},
    ),
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

/** A monitor as clients send it: flat, with the fields of its type. */
export const MonitorInput = v.variant("type", [HttpMonitor, TcpMonitor, MinecraftMonitor, HeartbeatMonitor]);
export type MonitorInput = v.InferOutput<typeof MonitorInput>;

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

export type MonitorStats = {
  hours: number;
  uptime: number | null;
  avgLatencyMs: number | null;
  series: { hour: string; checks: number; ok: number; avgLatencyMs: number | null }[];
};
