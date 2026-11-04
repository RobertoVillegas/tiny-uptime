import {
  barOfQuery,
  HISTORY_RANGES,
  isTimeZone,
  SLUG,
  type HistoryRange,
  type PublicStatusPage,
  type PublicView,
} from "@tiny-uptime/contracts";
import { renderStatusBadge } from "../../html/status-badge";
import { renderStatusFeed } from "../../html/status-feed";
import { renderStatusPage } from "../../html/status-page";
import { workspaceStub } from "../principal";
import { failWith, json } from "../respond";
import type { Ctx, Router } from "../router";

/** Where a public slug or hostname leads: a workspace, and one of its status pages (or its legacy page). */
export type PublicTarget = { workspaceId: string; pageId: string | null };

const HEARTBEAT_TOKEN = /^([a-z2-7]{12})_[0-9a-f]{32}$/;
/** Addresses resolved this isolate's lifetime, so busy pages skip the directory. */
const addresses = new Map<string, { target: PublicTarget | null; until: number }>();
const ADDRESS_CACHE_MS = 60_000;
const PUBLIC_CACHE = "public, max-age=30";
/** Badges are embedded through image proxies like GitHub's camo, which honour a short max-age. */
const BADGE_CACHE = "public, max-age=60, s-maxage=60";

/**
 * What anyone can reach: status pages (by slug, or at the root of a custom domain), their JSON,
 * feed and badge, and heartbeats.
 */
export function publicRoutes(router: Router): void {
  router
    .get("/", async (c) => page(c, await resolveRoot(c), "html"))
    .get("/badge.svg", async (c) => badge(c, await resolveRoot(c)))
    .get("/s/:slug", async (c) => page(c, await resolveSlug(c, c.params.slug!), "html"))
    .get("/s/:slug/rss", async (c) => page(c, await resolveSlug(c, c.params.slug!), "rss"))
    .get("/s/:slug/badge.svg", async (c) => badge(c, await resolveSlug(c, c.params.slug!)))
    .get("/api/public/:slug", async (c) => page(c, await resolveSlug(c, c.params.slug!), "json"))
    .get("/api/heartbeat/:token", heartbeat)
    .post("/api/heartbeat/:token", heartbeat);
}

async function page(c: Ctx, target: PublicTarget | null, format: "html" | "json" | "rss"): Promise<Response> {
  const status: PublicStatusPage | null = target
    ? await workspaceStub(c, target.workspaceId).publicPage(target.pageId, format === "rss" ? undefined : viewOf(c.url))
    : null;
  if (!status) return failWith(404, "not_found", "status page not found");
  if (format === "json") return json(200, status, { "cache-control": PUBLIC_CACHE, "access-control-allow-origin": "*" });
  if (format === "rss") {
    const link = `${c.url.origin}${c.url.pathname.replace(/\/rss$/, "")}`;
    return new Response(renderStatusFeed(status, link), {
      headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": PUBLIC_CACHE },
    });
  }
  const feedPath = c.url.pathname === "/" ? null : `${c.url.pathname}/rss`;
  return new Response(renderStatusPage(status, { feedPath, path: c.url.pathname, viewerZone: viewerZone(c.request) }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Times are in the visitor's zone, so no shared cache may hand one visitor's page to another.
      "cache-control": "private, max-age=30",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

/**
 * A shields-style badge with the page's overall status. An unknown page still gets an image, a
 * grey "unknown" with a 404, so a stale embed reads as such instead of a broken picture.
 */
async function badge(c: Ctx, target: PublicTarget | null): Promise<Response> {
  const status = target ? await workspaceStub(c, target.workspaceId).publicBadge(target.pageId) : null;
  return new Response(renderStatusBadge(status, c.url.searchParams.get("label")), {
    status: status ? 200 : 404,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": BADGE_CACHE,
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
    },
  });
}

/** The page at the root path: the one whose custom domain the request came in on, else `PUBLIC_SLUG`'s. */
async function resolveRoot(c: Ctx): Promise<PublicTarget | null> {
  const byHost = await resolve(c, `host:${c.url.hostname}`, (d) => d.resolveHost(c.url.hostname));
  if (byHost) return byHost;
  const slug = c.env.PUBLIC_SLUG;
  return slug ? resolveSlug(c, slug) : null;
}

/** The visitor's time zone, as Cloudflare places their IP; absent locally and for some networks. */
function viewerZone(request: Request): string | null {
  const zone = (request.cf as { timezone?: unknown } | undefined)?.timezone;
  return typeof zone === "string" && isTimeZone(zone) ? zone : null;
}

/** The range picked with `?days=`, if it is one a page offers, the bar opened with `?day=` or `?hour=`, and `?tz=utc`. */
function viewOf(url: URL): PublicView {
  const view: PublicView = {};
  const days = Number(url.searchParams.get("days"));
  if ((HISTORY_RANGES as readonly number[]).includes(days)) view.days = days as HistoryRange;
  const bar = barOfQuery(url.searchParams);
  if (bar !== undefined) view.bar = bar;
  if (url.searchParams.get("tz") === "utc") view.utc = true;
  return view;
}

function resolveSlug(c: Ctx, slug: string): Promise<PublicTarget | null> {
  if (!SLUG.test(slug)) return Promise.resolve(null);
  return resolve(c, `slug:${slug}`, (d) => d.resolve(slug));
}

async function resolve(
  c: Ctx,
  key: string,
  lookup: (directory: ReturnType<typeof directoryOf>) => Promise<PublicTarget | null>,
): Promise<PublicTarget | null> {
  const now = Date.now();
  const cached = addresses.get(key);
  if (cached && cached.until > now) return cached.target;
  const target = await lookup(directoryOf(c));
  if (addresses.size > 5000) addresses.clear();
  addresses.set(key, { target, until: now + ADDRESS_CACHE_MS });
  return target;
}

function directoryOf(c: Ctx) {
  return c.env.DIRECTORY.get(c.env.DIRECTORY.idFromName("directory"));
}

async function heartbeat(c: Ctx): Promise<Response> {
  const token = c.params.token!;
  const match = HEARTBEAT_TOKEN.exec(token);
  const known = match ? await workspaceStub(c, match[1]!).heartbeat(token) : false;
  return known ? json(200, { ok: true }) : failWith(404, "not_found", "unknown heartbeat");
}
