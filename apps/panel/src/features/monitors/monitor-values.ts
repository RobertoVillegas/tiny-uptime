import type {
  DNS_RECORD_TYPES,
  HTTP_METHODS,
  JsonAssertion,
  JsonAssertOp,
  Monitor,
  MonitorDraft,
  MonitorType,
} from "@tiny-uptime/contracts";
import { RULE_FIELDS, type AlertRules } from "./alert-rules";

/** Every input is text in the form; numbers and lists are parsed only when the draft is built. */
export type Values = {
  type: MonitorType;
  name: string;
  intervalSec: string;
  public: boolean;
  url: string;
  method: (typeof HTTP_METHODS)[number];
  expectedStatus: string;
  keyword: string;
  keywordMode: "contains" | "absent";
  jsonAssertions: string;
  headers: string;
  body: string;
  host: string;
  port: string;
  graceSec: string;
  timeoutSec: string;
  recordType: (typeof DNS_RECORD_TYPES)[number];
  expectedValue: string;
  expectedMode: "exact" | "contains";
  message: string;
  domain: string;
  warnDays: string;
  chainId: string;
};

/** The free-text fields, the ones a plain input edits (not the ones picked from a list). */
export type TextField = { [K in keyof Values]: string extends Values[K] ? K : never }[keyof Values];

export function initialValues(monitor?: Monitor): Values {
  const http = monitor?.type === "http" ? monitor : undefined;
  return {
    type: monitor?.type ?? "http",
    name: monitor?.name ?? "",
    intervalSec: String(monitor?.intervalSec ?? 300),
    public: monitor?.public ?? false,
    url: monitor && "url" in monitor ? monitor.url : "https://",
    method: http?.method ?? "GET",
    expectedStatus: http?.expectedStatus.join(", ") ?? "",
    keyword: http?.keyword?.value ?? "",
    keywordMode: http?.keyword?.mode ?? "contains",
    jsonAssertions: (http?.jsonAssertions ?? []).map(assertionLine).join("\n"),
    headers:
      monitor && "headers" in monitor
        ? Object.entries(monitor.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
        : "",
    body: http?.body ?? "",
    host: monitor && "host" in monitor ? monitor.host : "",
    port: monitor && "port" in monitor && monitor.port !== undefined ? String(monitor.port) : monitor?.type === "minecraft" ? "25565" : "",
    graceSec: monitor?.type === "heartbeat" ? String(monitor.graceSec) : "60",
    timeoutSec: monitor && "timeoutMs" in monitor ? String(monitor.timeoutMs / 1000) : "10",
    recordType: monitor?.type === "dns" ? monitor.recordType : "A",
    expectedValue: monitor?.type === "dns" ? (monitor.expected?.value ?? "") : "",
    expectedMode: monitor?.type === "dns" ? (monitor.expected?.mode ?? "exact") : "exact",
    message: monitor?.type === "websocket" ? (monitor.message ?? "") : "",
    domain: monitor?.type === "domain" ? monitor.domain : "",
    warnDays: monitor?.type === "domain" ? String(monitor.warnDays) : "30",
    chainId: monitor?.type === "evm" && monitor.chainId !== undefined ? String(monitor.chainId) : "",
  };
}

/** Builds the API draft for the chosen type, carrying only that type's fields. */
export function toDraft(v: Values): MonitorDraft {
  const common = { name: v.name, intervalSec: Number(v.intervalSec), public: v.public };
  const timeoutMs = Math.round(Number(v.timeoutSec) * 1000);
  switch (v.type) {
    case "http":
      return {
        type: "http",
        ...common,
        url: v.url,
        method: v.method,
        timeoutMs,
        expectedStatus: v.expectedStatus
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number),
        headers: parseHeaders(v.headers),
        ...(v.body && v.method !== "GET" && v.method !== "HEAD" ? { body: v.body } : {}),
        ...(v.keyword ? { keyword: { value: v.keyword, mode: v.keywordMode } } : {}),
        jsonAssertions: parseAssertions(v.jsonAssertions),
      };
    case "tcp":
    case "minecraft":
      return { type: v.type, ...common, host: v.host, port: Number(v.port), timeoutMs };
    case "heartbeat":
      return { type: "heartbeat", ...common, graceSec: Number(v.graceSec) };
    case "dns":
      return {
        type: "dns",
        ...common,
        host: v.host,
        recordType: v.recordType,
        timeoutMs,
        ...(v.expectedValue.trim() ? { expected: { value: v.expectedValue, mode: v.expectedMode } } : {}),
      };
    case "postgres":
    case "mysql":
    case "redis":
      return { type: v.type, ...common, host: v.host, timeoutMs, ...(v.port.trim() ? { port: Number(v.port) } : {}) };
    case "websocket":
      return {
        type: "websocket",
        ...common,
        url: v.url,
        headers: parseHeaders(v.headers),
        timeoutMs,
        ...(v.message ? { message: v.message } : {}),
      };
    case "domain":
      return { type: "domain", ...common, domain: v.domain, warnDays: Number(v.warnDays), timeoutMs };
    case "mcp":
    case "solana":
      return { type: v.type, ...common, url: v.url, headers: parseHeaders(v.headers), timeoutMs };
    case "evm":
      return {
        type: "evm",
        ...common,
        url: v.url,
        headers: parseHeaders(v.headers),
        timeoutMs,
        ...(v.chainId.trim() ? { chainId: Number(v.chainId) } : {}),
      };
  }
}

/** "Name: value" lines, as typed in the headers box. */
function parseHeaders(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]),
  );
}

/** How each comparison is typed in the JSON checks box. */
const OP_SYMBOLS: Record<JsonAssertOp, string> = {
  equals: "==",
  not_equals: "!=",
  contains: "contains",
  exists: "exists",
  not_exists: "missing",
  greater_than: ">",
  less_than: "<",
};
const SYMBOL_OPS = new Map(Object.entries(OP_SYMBOLS).map(([op, symbol]) => [symbol, op as JsonAssertOp]));

function assertionLine(a: JsonAssertion): string {
  return [a.path, OP_SYMBOLS[a.op], a.op.endsWith("exists") ? "" : a.value].filter(Boolean).join(" ");
}

/**
 * "path op value" lines, such as `$.status == ok`. The path ends at the first space outside
 * brackets, so `$["odd key"] exists` works; a line the box cannot read is sent with the unknown op
 * as typed so the server's message points at it.
 */
function parseAssertions(text: string): JsonAssertion[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let depth = 0;
      let end = 0;
      for (const char of line) {
        if (depth === 0 && /\s/.test(char)) break;
        if (char === "[") depth++;
        else if (char === "]") depth--;
        end += char.length;
      }
      const path = line.slice(0, end);
      const rest = line.slice(end).trim();
      const space = rest.search(/\s/);
      const symbol = space < 0 ? rest : rest.slice(0, space);
      const value = space < 0 ? "" : rest.slice(space + 1).trim();
      return { path, op: SYMBOL_OPS.get(symbol) ?? (symbol as JsonAssertOp), value };
    });
}

/** Server and schema field names, mapped to the input that shows the error. */
export function fieldOf(field: string): keyof Values | keyof AlertRules {
  const rule = RULE_FIELDS.find((f) => field === f || field.startsWith(`${f}.`));
  if (rule) return rule;
  if (field.startsWith("headers")) return "headers";
  if (field.startsWith("expectedStatus")) return "expectedStatus";
  if (field.startsWith("keyword")) return "keyword";
  if (field.startsWith("jsonAssertions")) return "jsonAssertions";
  if (field.startsWith("expected.")) return "expectedValue";
  if (field === "timeoutMs") return "timeoutSec";
  return field as keyof Values;
}
