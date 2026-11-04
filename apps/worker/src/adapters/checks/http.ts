import { parseJsonPath, type JsonAssertion, type JsonStep } from "@tiny-uptime/contracts";
import type { CheckOutcome, HttpTarget } from "@tiny-uptime/core";
import { errorText } from "./timeout";

export const USER_AGENT = "tiny-uptime/0.1 (+https://github.com/RobertoVillegas/tiny-uptime)";
/** Keyword checks read at most this much of the body. */
const MAX_KEYWORD_BYTES = 256 * 1024;

/** Redirects a check follows before giving up, as browsers do. */
const MAX_REDIRECTS = 10;

export async function checkHttp(target: HttpTarget): Promise<CheckOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  try {
    const res = await follow(target, AbortSignal.timeout(target.timeoutMs));
    const statusOk = target.expectedStatus.length ? target.expectedStatus.includes(res.status) : res.status < 400;
    const assertions = target.jsonAssertions ?? [];
    if (!statusOk || (!target.keyword && assertions.length === 0)) {
      await res.body?.cancel();
      return { ok: statusOk, latencyMs: elapsed(), detail: `HTTP ${res.status}` };
    }
    const text = await readText(res, MAX_KEYWORD_BYTES);
    if (target.keyword) {
      const found = text.includes(target.keyword.value);
      if (found !== (target.keyword.mode === "contains")) {
        return { ok: false, latencyMs: elapsed(), detail: `HTTP ${res.status}, keyword ${found ? "present" : "missing"}` };
      }
    }
    const failed = assertions.length ? failingAssertion(text, assertions) : null;
    return failed
      ? { ok: false, latencyMs: elapsed(), detail: `HTTP ${res.status}, ${failed}` }
      : { ok: true, latencyMs: elapsed(), detail: `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, latencyMs: elapsed(), detail: errorText(error) };
  }
}

/**
 * Fetches the target and follows its redirects by hand, sending back the cookies each hop sets.
 * Sites that set a session or consent cookie and redirect expect it, and without it loop until
 * the hop limit. Like browsers, 301–303 turn a POST into a GET without a body, and headers the
 * monitor sets (which may carry credentials) go only to the monitor's own host.
 */
async function follow(target: HttpTarget, signal: AbortSignal): Promise<Response> {
  const jar = new CookieJar();
  const home = new URL(target.url).host;
  let url = new URL(target.url);
  let method: string = target.method;
  let body = target.body;
  for (let hop = 0; ; hop++) {
    const headers = new Headers({ "user-agent": USER_AGENT, ...(url.host === home ? target.headers : {}) });
    const cookies = jar.header(url);
    if (cookies) headers.set("cookie", [headers.get("cookie"), cookies].filter(Boolean).join("; "));
    const res = await fetch(url, { method, headers, ...(body !== undefined ? { body } : {}), redirect: "manual", signal });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status > 399 || !location) return res;
    if (hop === MAX_REDIRECTS) {
      await res.body?.cancel();
      throw new Error(`more than ${MAX_REDIRECTS} redirects`);
    }
    jar.store(url, res.headers.getSetCookie());
    await res.body?.cancel();
    url = new URL(location, url);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`redirect to ${url.protocol} refused`);
    if (res.status <= 303 && method !== "GET" && method !== "HEAD") {
      method = "GET";
      body = undefined;
    }
  }
}

/** Just enough of a cookie jar for one check: name and value, scoped by domain and path. */
class CookieJar {
  private readonly cookies = new Map<string, { value: string; domain: string; hostOnly: boolean; path: string }>();

  store(from: URL, lines: string[]): void {
    for (const line of lines) {
      const [pair = "", ...attributes] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = from.hostname;
      let hostOnly = true;
      let path = "/";
      let expired = false;
      for (const attribute of attributes) {
        const [k = "", v = ""] = attribute.split("=").map((x) => x.trim());
        const key = k.toLowerCase();
        if (key === "domain" && v) {
          const d = v.replace(/^\./, "").toLowerCase();
          // A site may only set cookies for itself or a parent domain.
          if (from.hostname !== d && !from.hostname.endsWith(`.${d}`)) continue;
          domain = d;
          hostOnly = false;
        } else if (key === "path" && v.startsWith("/")) path = v;
        else if (key === "max-age" && Number(v) <= 0) expired = true;
      }
      const id = `${domain};${path};${name}`;
      if (expired) this.cookies.delete(id);
      else this.cookies.set(id, { value, domain, hostOnly, path });
    }
  }

  header(to: URL): string {
    const out: string[] = [];
    for (const [id, c] of this.cookies) {
      const domainOk = c.hostOnly ? to.hostname === c.domain : to.hostname === c.domain || to.hostname.endsWith(`.${c.domain}`);
      if (domainOk && to.pathname.startsWith(c.path)) out.push(`${id.slice(id.lastIndexOf(";") + 1)}=${c.value}`);
    }
    return out.join("; ");
  }
}

const MISSING = Symbol("missing");

/** The first assertion the body breaks, described for the incident, or null when all hold. */
function failingAssertion(text: string, assertions: JsonAssertion[]): string | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return "response is not JSON";
  }
  for (const a of assertions) {
    const steps = parseJsonPath(a.path);
    if (typeof steps === "string") return `${a.path} ${steps}`;
    const found = lookup(doc, steps);
    if (!holds(found, a)) {
      const shown = found === MISSING ? "missing" : JSON.stringify(found).slice(0, 80);
      return `${a.path} is ${shown}, expected ${a.op.replaceAll("_", " ")}${a.op.endsWith("exists") ? "" : ` ${a.value}`}`;
    }
  }
  return null;
}

function lookup(doc: unknown, steps: JsonStep[]): unknown {
  let cur: unknown = doc;
  for (const step of steps) {
    if (typeof step === "number") {
      if (!Array.isArray(cur) || step >= cur.length) return MISSING;
      cur = cur[step];
    } else {
      if (!cur || typeof cur !== "object" || Array.isArray(cur) || !Object.hasOwn(cur, step)) return MISSING;
      cur = (cur as Record<string, unknown>)[step];
    }
  }
  return cur;
}

/** Strings compare as written; other values by their JSON text, so `true` and `200` match unquoted. */
function holds(found: unknown, a: JsonAssertion): boolean {
  if (a.op === "exists") return found !== MISSING;
  if (a.op === "not_exists") return found === MISSING;
  if (found === MISSING) return false;
  const text = typeof found === "string" ? found : JSON.stringify(found);
  switch (a.op) {
    case "equals":
      return text === a.value;
    case "not_equals":
      return text !== a.value;
    case "contains":
      return text.includes(a.value);
    case "greater_than":
    case "less_than": {
      const n = typeof found === "number" ? found : Number(found);
      const limit = Number(a.value);
      if (!Number.isFinite(n) || !Number.isFinite(limit) || a.value.trim() === "") return false;
      return a.op === "greater_than" ? n > limit : n < limit;
    }
  }
}

export async function readText(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (bytes < limit) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return text;
}
