import { asObject, bool, hostname, httpUrl, int, InvalidInput, oneOf, str, type Input } from "../lib/validate";

export const MONITOR_TYPES = ["http", "tcp", "minecraft", "heartbeat"] as const;
export type MonitorType = (typeof MONITOR_TYPES)[number];

export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

export type HttpConfig = {
  url: string;
  method: (typeof HTTP_METHODS)[number];
  headers: Record<string, string>;
  body?: string;
  /** Status codes that count as up; empty means any status below 400. */
  expectedStatus: number[];
  keyword?: { value: string; mode: "contains" | "absent" };
  timeoutMs: number;
};
export type TcpConfig = { host: string; port: number; timeoutMs: number };
export type HeartbeatConfig = { graceSec: number };

export type MonitorConfig =
  | { type: "http"; config: HttpConfig }
  | { type: "tcp"; config: TcpConfig }
  | { type: "minecraft"; config: TcpConfig }
  | { type: "heartbeat"; config: HeartbeatConfig };

export type MonitorFields = MonitorConfig & {
  name: string;
  intervalSec: number;
  paused: boolean;
  public: boolean;
};

export const LIMITS = { minIntervalSec: 30, maxIntervalSec: 86_400, maxHeaders: 20, maxBodyBytes: 16_384 };

/** Parses a full monitor from a create request. */
export function parseMonitor(body: unknown): MonitorFields {
  const input = asObject(body);
  const type = oneOf(input, "type", MONITOR_TYPES);
  return {
    ...parseConfig(type, input),
    name: str(input, "name", { max: 100 }),
    intervalSec: int(input, "intervalSec", { min: LIMITS.minIntervalSec, max: LIMITS.maxIntervalSec, fallback: 300 }),
    paused: bool(input, "paused", false),
    public: bool(input, "public", false),
  };
}

/** Applies a partial update on top of the stored monitor; the type cannot change. */
export function mergeMonitor(current: MonitorFields, body: unknown): MonitorFields {
  const input = asObject(body);
  if (input.type !== undefined && input.type !== current.type) throw new InvalidInput("type", "cannot be changed");
  const merged: Input = { ...flatten(current), ...input };
  return parseMonitor({ ...merged, type: current.type });
}

function parseConfig(type: MonitorType, input: Input): MonitorConfig {
  switch (type) {
    case "http":
      return { type, config: parseHttp(input) };
    case "tcp":
      return { type, config: parseTcp(input, undefined) };
    case "minecraft":
      return { type, config: parseTcp(input, 25565) };
    case "heartbeat":
      return { type, config: { graceSec: int(input, "graceSec", { min: 0, max: 86_400, fallback: 60 }) } };
  }
}

function parseHttp(input: Input): HttpConfig {
  const method = oneOf(input, "method", HTTP_METHODS, "GET");
  const body = str(input, "body", { min: 0, max: LIMITS.maxBodyBytes, optional: true });
  if (body !== undefined && (method === "GET" || method === "HEAD")) throw new InvalidInput("body", `is not allowed with ${method}`);
  if (body !== undefined && new TextEncoder().encode(body).length > LIMITS.maxBodyBytes) {
    throw new InvalidInput("body", `must be at most ${LIMITS.maxBodyBytes} bytes`);
  }
  const config: HttpConfig = {
    url: httpUrl(input, "url"),
    method,
    headers: parseHeaders(input.headers),
    expectedStatus: parseStatuses(input.expectedStatus),
    timeoutMs: int(input, "timeoutMs", { min: 1000, max: 30_000, fallback: 10_000 }),
  };
  if (body !== undefined && body !== "") config.body = body;
  if (input.keyword !== undefined && input.keyword !== null) {
    const keyword = asObject(input.keyword, "keyword");
    config.keyword = {
      value: str(keyword, "value", { max: 200 }),
      mode: oneOf(keyword, "mode", ["contains", "absent"] as const, "contains"),
    };
  }
  return config;
}

function parseTcp(input: Input, defaultPort: number | undefined): TcpConfig {
  return {
    host: hostname(input, "host"),
    port: int(input, "port", { min: 1, max: 65_535, ...(defaultPort ? { fallback: defaultPort } : {}) }),
    timeoutMs: int(input, "timeoutMs", { min: 1000, max: 30_000, fallback: 10_000 }),
  };
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;

function parseHeaders(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  const input = asObject(value, "headers");
  const entries = Object.entries(input);
  if (entries.length > LIMITS.maxHeaders) throw new InvalidInput("headers", `must have at most ${LIMITS.maxHeaders} entries`);
  const out: Record<string, string> = {};
  for (const [name, raw] of entries) {
    if (!HEADER_NAME.test(name)) throw new InvalidInput(`headers.${name}`, "is not a valid header name");
    if (typeof raw !== "string" || raw.length > 1024 || /[\r\n]/.test(raw)) {
      throw new InvalidInput(`headers.${name}`, "must be a single-line string of at most 1024 characters");
    }
    out[name] = raw;
  }
  return out;
}

function parseStatuses(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new InvalidInput("expectedStatus", "must be a list of at most 20 status codes");
  return value.map((code, i) => {
    if (!Number.isInteger(code) || code < 100 || code > 599) throw new InvalidInput(`expectedStatus.${i}`, "must be a status code");
    return code as number;
  });
}

/** The flat shape used by the API, the inverse of parseMonitor. */
export function flatten(monitor: MonitorFields): Input {
  const { config, ...rest } = monitor;
  return { ...rest, ...config };
}
