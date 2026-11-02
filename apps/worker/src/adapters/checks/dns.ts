import type { CheckOutcome, DnsTarget } from "@tiny-uptime/core";
import { readText, USER_AGENT } from "./http";
import { errorText } from "./timeout";

const RESOLVER = "https://cloudflare-dns.com/dns-query";
const TYPE_CODES = { A: 1, AAAA: 28, CNAME: 5, MX: 15, TXT: 16, NS: 2 } as const;
/** DNS response codes worth a word; others are reported by number. */
const RCODES: Record<number, string> = {
  2: "resolver failed (SERVFAIL)",
  3: "name does not exist (NXDOMAIN)",
  5: "query refused (REFUSED)",
};

type Answer = { name: string; type: number; data: string };

/** Resolves through a fixed public resolver over HTTPS, so the check never connects to what a record points at. */
export async function checkDns(target: DnsTarget): Promise<CheckOutcome> {
  const started = Date.now();
  const done = (ok: boolean, detail: string): CheckOutcome => ({ ok, latencyMs: Date.now() - started, detail });
  try {
    const url = `${RESOLVER}?name=${encodeURIComponent(bare(target.host))}&type=${target.recordType}`;
    const res = await fetch(url, {
      headers: { accept: "application/dns-json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(target.timeoutMs),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return done(false, `resolver returned HTTP ${res.status}`);
    }
    const body = parse(await readText(res, 256 * 1024));
    if (typeof body?.Status !== "number") return done(false, "resolver returned an invalid response");
    if (body.Status !== 0) return done(false, RCODES[body.Status] ?? `DNS error code ${body.Status}`);

    const values = recordsOf(body.Answer, target);
    if (!values.length) return done(false, `no ${target.recordType} records`);
    const found = summary(values);
    if (!target.expected) return done(true, found);
    const ok = values.some((value) => matches(value, target.expected!, target.recordType));
    return done(
      ok,
      ok ? found : `${target.expected.mode === "exact" ? "no match for" : "none contain"} ${target.expected.value}; found ${found}`,
    );
  } catch (error) {
    return done(false, errorText(error));
  }
}

/**
 * The values of the asked type that belong to the name or the CNAME chain it leads to. A resolver
 * answer may carry other records, which say nothing about this name.
 */
function recordsOf(raw: unknown, target: DnsTarget): string[] {
  const answers = Array.isArray(raw) ? raw.filter(isAnswer) : [];
  const owners = new Set([bare(target.host)]);
  for (let grew = true; grew;) {
    grew = false;
    for (const a of answers) {
      if (a.type === TYPE_CODES.CNAME && owners.has(bare(a.name)) && !owners.has(bare(a.data))) {
        owners.add(bare(a.data));
        grew = true;
      }
    }
  }
  return answers.filter((a) => a.type === TYPE_CODES[target.recordType] && owners.has(bare(a.name))).map((a) => a.data);
}

/** Names compare without case or the trailing dot; TXT stays as written, since it is free text. */
function matches(value: string, expected: NonNullable<DnsTarget["expected"]>, type: DnsTarget["recordType"]): boolean {
  const fold = (v: string) => (type === "TXT" ? v : v.toLowerCase());
  if (expected.mode === "contains") return fold(value).includes(fold(expected.value));
  return normalize(value, type) === normalize(expected.value, type);
}

function normalize(value: string, type: DnsTarget["recordType"]): string {
  const v = value.trim();
  if (type === "CNAME" || type === "NS") return bare(v);
  if (type === "MX") {
    const parts = /^(\d+)\s+(\S+)$/.exec(v);
    return parts ? `${Number(parts[1])} ${bare(parts[2]!)}` : v.toLowerCase();
  }
  if (type === "AAAA") {
    try {
      return new URL(`http://[${v}]/`).hostname;
    } catch {
      return v.toLowerCase();
    }
  }
  return type === "TXT" ? stripQuotes(v) : v;
}

/** Resolvers quote TXT data; people usually type it without quotes. */
function stripQuotes(value: string): string {
  return value.replace(/^"(.*)"$/s, "$1");
}

function bare(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, "");
}

function summary(values: string[]): string {
  const shown = values.slice(0, 3).map((v) => (v.length > 80 ? `${v.slice(0, 80)}…` : v));
  return values.length > 3 ? `${shown.join(", ")} and ${values.length - 3} more` : shown.join(", ");
}

function isAnswer(value: unknown): value is Answer {
  const a = value as Partial<Answer> | null;
  return typeof a?.name === "string" && typeof a.type === "number" && typeof a.data === "string";
}

function parse(text: string): { Status?: unknown; Answer?: unknown } | undefined {
  try {
    return JSON.parse(text) as { Status?: unknown; Answer?: unknown };
  } catch {
    return undefined;
  }
}
