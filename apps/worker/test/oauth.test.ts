import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { VirtualAuthenticator } from "./authenticator";

const ORIGIN = "https://tiny.test";
const OPERATOR = { authorization: "Bearer test-operator-token", "content-type": "application/json" };
const REDIRECT = "http://127.0.0.1:33418/callback";

const fetchWorker = (path: string, init: RequestInit = {}) =>
  exports.default.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }));

async function operator(path: string, body: unknown) {
  return (await (await fetchWorker(path, { method: "POST", headers: OPERATOR, body: JSON.stringify(body) })).json()) as any;
}

/** A member with a full session cookie, through a real passkey sign-up. */
async function member(role = "owner") {
  const ws = await operator("/api/admin/workspaces", { name: "Acme", slug: `o-${crypto.randomUUID().slice(0, 8)}` });
  const invite = await operator("/api/admin/invites", {
    workspaceId: ws.id,
    email: `${crypto.randomUUID().slice(0, 8)}@example.com`,
    role,
  });
  const token = new URL(invite.inviteUrl).searchParams.get("token")!;
  const json = { origin: ORIGIN, "content-type": "application/json" };
  const options = (await (
    await fetchWorker("/auth/invite/options", { method: "POST", headers: json, body: JSON.stringify({ token, name: "Ana" }) })
  ).json()) as any;
  const registration = await (await VirtualAuthenticator.create()).register({ challenge: options.challenge, origin: ORIGIN });
  const done = await fetchWorker("/auth/invite/complete", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ token, name: "Ana", challengeId: options.challengeId, registration }),
  });
  return { ws: ws as { id: string; apiKey: string }, cookie: done.headers.get("set-cookie")!.split(";")[0]! };
}

async function register(redirectUris = [REDIRECT]) {
  const res = await fetchWorker("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude Code", redirect_uris: redirectUris, token_endpoint_auth_method: "none" }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function pkce() {
  const verifier = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

function authorizeQuery(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    resource: `${ORIGIN}/mcp`,
    ...extra,
  });
}

async function consent(cookie: string, query: URLSearchParams, form: Record<string, string>) {
  return fetchWorker("/oauth/authorize", {
    method: "POST",
    headers: { cookie, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...Object.fromEntries(query), requested_scope: query.get("scope") ?? "", ...form }),
  });
}

async function tokenRequest(form: Record<string, string>) {
  const res = await fetchWorker("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function mcp(token: string, method: string, params?: unknown) {
  const res = await fetchWorker("/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return { status: res.status, headers: res.headers, body: res.status === 200 ? ((await res.json()) as any) : null };
}

/** Runs the whole flow and returns the tokens. */
async function connect(cookie: string, workspaceId: string, scope = "mcp:read mcp:write") {
  const client = (await register()).body;
  const { verifier, challenge } = await pkce();
  const query = authorizeQuery(client.client_id, challenge);
  const approved = await consent(cookie, query, { decision: "allow", workspace: workspaceId, scope });
  const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_verifier: verifier,
  });
  return { client, tokens: tokens.body };
}

describe("OAuth for MCP clients", () => {
  it("publishes discovery metadata and points unauthenticated MCP calls at it", async () => {
    const resource = (await (await fetchWorker("/.well-known/oauth-protected-resource/mcp")).json()) as any;
    expect(resource).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
    const server = (await (await fetchWorker("/.well-known/oauth-authorization-server")).json()) as any;
    expect(server).toMatchObject({
      issuer: ORIGIN,
      code_challenge_methods_supported: ["S256"],
      registration_endpoint: `${ORIGIN}/oauth/register`,
    });

    const anonymous = await mcp("", "ping");
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
    expect((await mcp(`tuat_${"0".repeat(64)}`, "ping")).headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("signs a client in with consent and PKCE, and its token works on MCP", async () => {
    const { ws, cookie } = await member();
    const client = (await register()).body;
    const { verifier, challenge } = await pkce();
    const query = authorizeQuery(client.client_id, challenge);

    const signedOut = await fetchWorker(`/oauth/authorize?${query}`);
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get("location")).toBe(`/app/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);

    const page = await fetchWorker(`/oauth/authorize?${query}`, { headers: { cookie } });
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    const html = await page.text();
    expect(html).toContain("Connect Claude Code to tiny-uptime?");
    expect(html).toContain("127.0.0.1:33418");

    expect(await consent(cookie, query, { decision: "allow", workspace: ws.id, scope: "mcp:read mcp:write" }).then((r) => r.status)).toBe(
      302,
    );
    // A second approval of the same request gets its own code; take that one through the token endpoint.
    const approved = await consent(cookie, query, { decision: "allow", workspace: ws.id, scope: "mcp:read mcp:write" });
    const back = new URL(approved.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("xyz");
    expect(back.searchParams.get("iss")).toBe(ORIGIN);
    const code = back.searchParams.get("code")!;

    const wrongVerifier = await tokenRequest({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_verifier: "x".repeat(43),
    });
    expect(wrongVerifier.body.error).toBe("invalid_grant");
    // The failed attempt used the code up.
    expect(
      (
        await tokenRequest({
          grant_type: "authorization_code",
          code,
          client_id: client.client_id,
          redirect_uri: REDIRECT,
          code_verifier: verifier,
        })
      ).body.error,
    ).toBe("invalid_grant");

    const { tokens } = await connect(cookie, ws.id);
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "mcp:read mcp:write" });
    const created = await mcp(tokens.access_token, "tools/call", {
      name: "create_monitor",
      arguments: { monitor: { type: "heartbeat", name: "Via OAuth", paused: true } },
    });
    expect(created.body.result.isError).toBeUndefined();

    const grants = (await (await fetchWorker("/auth/oauth-grants", { headers: { cookie } })).json()) as any[];
    expect(grants.some((g) => g.clientName === "Claude Code" && g.workspaceId === ws.id)).toBe(true);
  });

  it("rotates refresh tokens and revokes the grant when an old one comes back", async () => {
    const { ws, cookie } = await member();
    const { client, tokens } = await connect(cookie, ws.id);
    const next = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
    expect(next.status).toBe(200);
    expect(next.body.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcp(next.body.access_token, "ping")).status).toBe(200);

    const replay = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id });
    expect(replay.body.error).toBe("invalid_grant");
    expect((await mcp(next.body.access_token, "ping")).status).toBe(401);
  });

  it("limits read-only grants and viewers, and ends access on revocation", async () => {
    const owner = await member();
    const readOnly = await connect(owner.cookie, owner.ws.id, "mcp:read");
    expect(readOnly.tokens.scope).toBe("mcp:read");
    const write = await mcp(readOnly.tokens.access_token, "tools/call", {
      name: "create_monitor",
      arguments: { monitor: { type: "heartbeat", name: "Nope" } },
    });
    expect(write.body.result.isError).toBe(true);
    expect(
      (await mcp(readOnly.tokens.access_token, "tools/call", { name: "list_monitors", arguments: {} })).body.result.isError,
    ).toBeUndefined();

    const viewer = await member("viewer");
    expect((await connect(viewer.cookie, viewer.ws.id)).tokens.scope).toBe("mcp:read");

    const full = await connect(owner.cookie, owner.ws.id);
    const revoked = await fetchWorker("/oauth/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: full.tokens.refresh_token }),
    });
    expect(revoked.status).toBe(200);
    expect((await mcp(full.tokens.access_token, "ping")).status).toBe(401);

    const another = await connect(owner.cookie, owner.ws.id);
    const grants = (await (await fetchWorker("/auth/oauth-grants", { headers: { cookie: owner.cookie } })).json()) as any[];
    const disconnect = await fetchWorker(`/auth/oauth-grants/${grants[0].id}`, {
      method: "DELETE",
      headers: { cookie: owner.cookie, origin: ORIGIN },
    });
    expect(disconnect.status).toBe(200);
    expect((await mcp(another.tokens.access_token, "ping")).status).toBe(401);
  });

  it("refuses unsafe redirects, unknown clients, missing PKCE, other origins and denial", async () => {
    expect((await register(["http://evil.example/cb"])).body.error).toBe("invalid_redirect_uri");
    expect((await register(["https://ok.example/cb#frag"])).body.error).toBe("invalid_redirect_uri");
    expect((await register(["com.example.app:/callback"])).status).toBe(201);

    const { ws, cookie } = await member();
    const client = (await register()).body;
    const { challenge } = await pkce();

    const unknown = await fetchWorker(`/oauth/authorize?${authorizeQuery("nope", challenge)}`, { headers: { cookie } });
    expect(unknown.status).toBe(400);
    const otherRedirect = await fetchWorker(
      `/oauth/authorize?${authorizeQuery(client.client_id, challenge, { redirect_uri: "https://evil.example/cb" })}`,
      { headers: { cookie } },
    );
    expect(otherRedirect.status).toBe(400);
    // Loopback redirects may change port (RFC 8252).
    const otherPort = await fetchWorker(
      `/oauth/authorize?${authorizeQuery(client.client_id, challenge, { redirect_uri: "http://127.0.0.1:5555/callback" })}`,
      { headers: { cookie } },
    );
    expect(otherPort.status).toBe(200);
    const plain = await fetchWorker(`/oauth/authorize?${authorizeQuery(client.client_id, challenge, { code_challenge_method: "plain" })}`, {
      headers: { cookie },
    });
    expect(new URL(plain.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    const wrongResource = await fetchWorker(
      `/oauth/authorize?${authorizeQuery(client.client_id, challenge, { resource: "https://other.test/mcp" })}`,
      { headers: { cookie } },
    );
    expect(new URL(wrongResource.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");

    const query = authorizeQuery(client.client_id, challenge);
    const crossSite = await fetchWorker("/oauth/authorize", {
      method: "POST",
      headers: { cookie, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...Object.fromEntries(query), decision: "allow", workspace: ws.id }),
    });
    expect(crossSite.status).toBe(403);
    const denied = await consent(cookie, query, { decision: "deny", workspace: ws.id });
    expect(new URL(denied.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    const notMine = await consent(cookie, query, { decision: "allow", workspace: "aaaaaaaaaaaa" });
    expect(notMine.status).toBe(400);
  });
});
