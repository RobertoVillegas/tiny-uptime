import type { Env, PublicMonitor } from "./hub";
import { renderStatusPage } from "./page";

export { Hub } from "./hub";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const hub = env.HUB.get(env.HUB.idFromName("main"));

    const beat = url.pathname.match(/^\/api\/heartbeat\/([0-9a-f]{32})$/);
    if (beat) {
      if (request.method !== "GET" && request.method !== "POST") return new Response(null, { status: 405 });
      const known = await hub.heartbeat(beat[1]!);
      return Response.json({ ok: known }, { status: known ? 200 : 404 });
    }

    if (url.pathname === "/api/status") {
      return Response.json(await hub.snapshot(), { headers: { "cache-control": "public, max-age=30" } });
    }

    if (url.pathname === "/api/admin/monitors") {
      if (!(await authorized(request, env))) return new Response("unauthorized", { status: 401 });
      return Response.json(await hub.adminMonitors());
    }

    if (url.pathname === "/") {
      const monitors: PublicMonitor[] = await hub.snapshot();
      return new Response(renderStatusPage(monitors, Date.now()), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=30" },
      });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function authorized(request: Request, env: Env): Promise<boolean> {
  const expected = env.ADMIN_TOKEN;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!expected || !given) return false;
  const [a, b] = await Promise.all([digest(expected), digest(given)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function digest(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}
