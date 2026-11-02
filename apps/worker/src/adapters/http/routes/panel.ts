import { failWith } from "../respond";
import type { Ctx, Router } from "../router";

/**
 * The panel is a single-page app: its files under /app/assets are served by static assets directly,
 * and every other /app path gets its index.html, so deep links and reloads work.
 */
export function panelRoutes(router: Router): void {
  router.get("/app/*", panel);
}

/** The panel loads only its own scripts and styles, talks only to this origin and cannot be framed. */
const SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "cache-control": "no-cache",
};

async function panel(c: Ctx): Promise<Response> {
  if (!c.env.ASSETS) return failWith(404, "not_found", "the panel is not built");
  // No conditional headers: a 304 would have no body to add security headers to, and the HTML is tiny.
  const res = await c.env.ASSETS.fetch(new Request(new URL("/app/", c.url)));
  if (!res.ok) return failWith(404, "not_found", "the panel is not built");
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(res.body, { status: 200, headers });
}
