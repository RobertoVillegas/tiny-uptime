import type { HttpTarget } from "@tiny-uptime/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHttp } from "../src/adapters/checks/http";
import { errorText } from "../src/adapters/checks/timeout";

describe("check failure causes", () => {
  it("turns runtime errors into causes people can act on", () => {
    expect(errorText(new Error("internal error; reference = abc123"))).toBe("could not connect (DNS lookup or connection failed)");
    expect(errorText(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe("timed out");
    expect(errorText(new Error("timeout after 10000 ms"))).toBe("timeout after 10000 ms");
    expect(errorText(new Error("Connection refused"))).toBe("connection refused");
    expect(errorText(new Error("HTTP 503"))).toBe("HTTP 503");
  });
});

const target = (over: Partial<HttpTarget> = {}): HttpTarget => ({
  url: "https://site.test/",
  method: "GET",
  headers: {},
  expectedStatus: [],
  jsonAssertions: [],
  timeoutMs: 5000,
  ...over,
});
const redirect = (to: string, status = 302, cookie?: string) =>
  new Response(null, { status, headers: { location: to, ...(cookie ? { "set-cookie": cookie } : {}) } });

const check = (jsonAssertions: HttpTarget["jsonAssertions"]) => checkHttp(target({ jsonAssertions }));

describe("HTTP checks", () => {
  type Seen = { url: string; method: string; cookie: string | null; auth: string | null };
  let seen: Seen[] = [];
  const serve = (routes: Record<string, (req: Seen) => Response>) => {
    seen = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input instanceof URL ? input.toString() : String(input);
      const headers = new Headers(init?.headers);
      const req = { url, method: init?.method ?? "GET", cookie: headers.get("cookie"), auth: headers.get("authorization") };
      seen.push(req);
      return routes[url]?.(req) ?? new Response("missing", { status: 404 });
    });
  };
  afterEach(() => vi.restoreAllMocks());
  it("sends back cookies a site sets while redirecting", async () => {
    serve({
      "https://site.test/": (r) =>
        r.cookie?.includes("consent=yes") ? new Response("home") : redirect("/consent", 302, "consent=yes; Path=/"),
      "https://site.test/consent": () => redirect("https://site.test/"),
    });
    const outcome = await checkHttp(target());
    expect(outcome).toMatchObject({ ok: true, detail: "HTTP 200" });
    expect(seen.map((s) => s.cookie)).toEqual([null, "consent=yes", "consent=yes"]);
  });

  it("stops a redirect loop and keeps credentials on the monitor's host", async () => {
    serve({ "https://site.test/": () => redirect("https://site.test/") });
    expect((await checkHttp(target())).detail).toBe("more than 10 redirects");

    serve({
      "https://site.test/": () => redirect("https://other.test/", 301, "session=1; Domain=evil.test"),
      "https://other.test/": () => new Response("ok"),
    });
    const outcome = await checkHttp(target({ method: "POST", body: "x", headers: { authorization: "Bearer s3cret" } }));
    expect(outcome.ok).toBe(true);
    expect(seen.map((s) => [s.method, s.auth, s.cookie])).toEqual([
      ["POST", "Bearer s3cret", null],
      ["GET", null, null],
    ]);
  });

  it("checks fields of a JSON body", async () => {
    const body = { status: "ok", data: { items: [{ state: "degraded", load: 0.4 }] }, "odd key": true };
    serve({ "https://site.test/": () => Response.json(body) });
    expect(
      await check([
        { path: "$.status", op: "equals", value: "ok" },
        { path: "data.items[0].load", op: "less_than", value: "0.5" },
        { path: '$["odd key"]', op: "equals", value: "true" },
        { path: "$.missing", op: "not_exists", value: "" },
      ]),
    ).toMatchObject({ ok: true });
    expect(await check([{ path: "$.data.items[0].state", op: "equals", value: "ok" }])).toMatchObject({
      ok: false,
      detail: 'HTTP 200, $.data.items[0].state is "degraded", expected equals ok',
    });
    expect((await check([{ path: "$.nope", op: "exists", value: "" }])).detail).toBe("HTTP 200, $.nope is missing, expected exists");

    serve({ "https://site.test/": () => new Response("<html>") });
    expect((await check([{ path: "status", op: "exists", value: "" }])).detail).toBe("HTTP 200, response is not JSON");
  });
});
