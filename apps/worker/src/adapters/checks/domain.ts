import type { CheckOutcome, DomainTarget } from "@tiny-uptime/core";
import { readText, USER_AGENT } from "./http";
import { errorText } from "./timeout";

/** rdap.org redirects each domain to its registry's RDAP server, so no bootstrap list is kept here. */
const RDAP = "https://rdap.org/domain/";
const DAY_MS = 86_400_000;

/**
 * Down when the domain's registration expires within `warnDays`, or has expired. Latency is not
 * recorded: it measures the registry, not anything the domain serves.
 */
export async function checkDomain(target: DomainTarget): Promise<CheckOutcome> {
  try {
    const res = await fetch(`${RDAP}${encodeURIComponent(target.domain)}`, {
      // rdap.org refuses requests without a user agent.
      headers: { accept: "application/rdap+json, application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(target.timeoutMs),
    });
    if (res.status === 404) {
      await res.body?.cancel();
      return done(false, "the registry has no record of this domain");
    }
    if (!res.ok) {
      await res.body?.cancel();
      return done(false, res.status === 429 ? "the registry rate limited the lookup (HTTP 429)" : `RDAP returned HTTP ${res.status}`);
    }
    const expiresAt = expiration(parse(await readText(res, 1024 * 1024)), target.domain);
    if (expiresAt === null) return done(false, "the registry publishes no expiration date");

    const date = new Date(expiresAt).toISOString().slice(0, 10);
    const days = Math.ceil((expiresAt - Date.now()) / DAY_MS);
    if (days <= 0) return done(false, `expired on ${date}`);
    return done(days > target.warnDays, `expires in ${days} ${days === 1 ? "day" : "days"} (${date})`);
  } catch (error) {
    return done(false, errorText(error));
  }
}

function done(ok: boolean, detail: string): CheckOutcome {
  return { ok, latencyMs: null, detail };
}

/** The earliest expiration event of the domain asked for, or null when there is none. */
function expiration(raw: unknown, domain: string): number | null {
  const o = raw as { objectClassName?: unknown; ldhName?: unknown; events?: unknown } | undefined;
  if (o?.objectClassName !== "domain" || typeof o.ldhName !== "string" || o.ldhName.toLowerCase().replace(/\.$/, "") !== domain) {
    throw new Error("RDAP did not return the requested domain");
  }
  const dates = (Array.isArray(o.events) ? o.events : []).flatMap((event: { eventAction?: unknown; eventDate?: unknown } | null) => {
    if (event?.eventAction !== "expiration" || typeof event.eventDate !== "string") return [];
    const time = Date.parse(event.eventDate);
    return Number.isFinite(time) ? [time] : [];
  });
  return dates.length ? Math.min(...dates) : null;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("RDAP returned invalid JSON");
  }
}
