import type { Env } from "../../runtime/env";

export type Ctx = { request: Request; env: Env; url: URL; params: Record<string, string> };
export type Handler = (ctx: Ctx) => Promise<Response> | Response;

type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

/**
 * A route table: `router.get("/api/v1/monitors/:id", handler)`, and `/app/*` for a path and everything
 * below it. Patterns are compiled once, at startup.
 */
export class Router {
  private readonly routes: Route[] = [];

  get(path: string, handler: Handler) {
    return this.on("GET", path, handler);
  }
  post(path: string, handler: Handler) {
    return this.on("POST", path, handler);
  }
  patch(path: string, handler: Handler) {
    return this.on("PATCH", path, handler);
  }
  delete(path: string, handler: Handler) {
    return this.on("DELETE", path, handler);
  }

  on(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const source = path
      .replace(/:([a-zA-Z]+)/g, (_, key: string) => {
        keys.push(key);
        return "([^/]+)";
      })
      .replace(/\/\*$/, () => {
        keys.push("rest");
        return "(?:/(.*))?";
      });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
    return this;
  }

  /** The handler for this request, or a 404/405 answer. */
  match(request: Request, url: URL): { handler: Handler; params: Record<string, string> } | { status: 404 | 405 } {
    let pathMatched = false;
    for (const route of this.routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      pathMatched = true;
      const method = request.method === "HEAD" ? "GET" : request.method;
      if (route.method !== method) continue;
      const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(match[i + 1] ?? "")]));
      return { handler: route.handler, params };
    }
    return { status: pathMatched ? 405 : 404 };
  }
}
