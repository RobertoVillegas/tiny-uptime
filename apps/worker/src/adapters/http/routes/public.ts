import { SLUG } from "@tiny-uptime/contracts";
import { renderStatusPage } from "../../html/status-page";
import { workspaceStub } from "../principal";
import { failWith, json } from "../respond";
import type { Ctx, Router } from "../router";

const HEARTBEAT_TOKEN = /^([a-z2-7]{12})_[0-9a-f]{32}$/;
/** Slug → workspace id, kept for the life of the isolate so status pages skip the directory. */
const slugs = new Map<string, string>();

/** What anyone can reach: status pages, their JSON, and heartbeat pings. */
export function publicRoutes(router: Router): void {
  router
    .get("/", (c) => statusPage(c, c.env.PUBLIC_SLUG))
    .get("/s/:slug", (c) => statusPage(c, c.params.slug))
    .get("/api/public/:slug", async (c) => {
      const status = await publicStatus(c, c.params.slug);
      if (!status) return failWith(404, "not_found", "status page not found");
      return json(200, status, { "cache-control": "public, max-age=30", "access-control-allow-origin": "*" });
    })
    .get("/api/heartbeat/:token", heartbeat)
    .post("/api/heartbeat/:token", heartbeat);
}

async function heartbeat(c: Ctx): Promise<Response> {
  const token = c.params.token!;
  const match = HEARTBEAT_TOKEN.exec(token);
  const known = match ? await workspaceStub(c, match[1]!).heartbeat(token) : false;
  return known ? json(200, { ok: true }) : failWith(404, "not_found", "unknown heartbeat");
}

async function statusPage(c: Ctx, slug: string | undefined): Promise<Response> {
  const status = slug ? await publicStatus(c, slug) : null;
  if (!status) return failWith(404, "not_found", "status page not found");
  return new Response(renderStatusPage(status.name, status.monitors, Date.now()), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=30" },
  });
}

async function publicStatus(c: Ctx, slug: string | undefined) {
  if (!slug || !SLUG.test(slug)) return null;
  let id = slugs.get(slug);
  if (!id) {
    id = (await c.env.DIRECTORY.get(c.env.DIRECTORY.idFromName("directory")).resolve(slug)) ?? undefined;
    if (!id) return null;
    slugs.set(slug, id);
  }
  return workspaceStub(c, id).publicStatus();
}
