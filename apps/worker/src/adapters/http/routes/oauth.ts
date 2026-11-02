import { ClientRegistrationInput, OAUTH_SCOPES, validate, type OAuthScope } from "@tiny-uptime/contracts";
import { renderConsent, renderOAuthError } from "../../html/oauth-pages";
import { json, reply } from "../respond";
import type { Ctx, Router } from "../router";
import { authStore, sameOrigin, signedIn } from "../session";
import { accountRoute } from "./auth-route";

/**
 * An OAuth 2.1 authorization server just for MCP clients (the MCP authorization spec): metadata
 * discovery (RFC 9728, RFC 8414), open dynamic registration of public clients (RFC 7591), the
 * authorization code flow with PKCE S256 and a consent page, rotating refresh tokens, and revocation.
 */
export function oauthRoutes(router: Router): void {
  router
    .get("/.well-known/oauth-protected-resource", (c) => cors(json(200, resourceMetadata(c.url))))
    .get("/.well-known/oauth-protected-resource/api/mcp", (c) => cors(json(200, resourceMetadata(c.url))))
    .get("/.well-known/oauth-authorization-server", (c) => cors(json(200, serverMetadata(c.url))))
    .post("/oauth/register", register)
    .get("/oauth/authorize", authorizePage)
    .post("/oauth/authorize", authorizeDecision)
    .post("/oauth/token", token)
    .post("/oauth/revoke", revoke)
    .get(
      "/auth/oauth-grants",
      accountRoute(async (c) => json(200, await c.store.oauthGrants(c.session.info.userId))),
    )
    .delete(
      "/auth/oauth-grants/:id",
      accountRoute(async (c) => reply(await c.store.revokeOAuthGrant(c.session.info.userId, c.params.id!), () => ({ ok: true }))),
    );
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/api/mcp",
    "/.well-known/oauth-authorization-server",
    "/oauth/register",
    "/oauth/token",
    "/oauth/revoke",
  ]) {
    router.on("OPTIONS", path, () => cors(new Response(null, { status: 204 })));
  }
}

export function mcpResource(url: URL): string {
  return `${url.origin}/api/mcp`;
}

export function resourceMetadataUrl(url: URL): string {
  return `${url.origin}/.well-known/oauth-protected-resource/api/mcp`;
}

function resourceMetadata(url: URL) {
  return {
    resource: mcpResource(url),
    authorization_servers: [url.origin],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "tiny-uptime",
  };
}

function serverMetadata(url: URL) {
  return {
    issuer: url.origin,
    authorization_endpoint: `${url.origin}/oauth/authorize`,
    token_endpoint: `${url.origin}/oauth/token`,
    registration_endpoint: `${url.origin}/oauth/register`,
    revocation_endpoint: `${url.origin}/oauth/revoke`,
    scopes_supported: OAUTH_SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
}

/** Token, registration and metadata answers carry no cookies, so any origin may read them (browser MCP clients). */
function cors(res: Response): Response {
  res.headers.set("access-control-allow-origin", "*");
  res.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  res.headers.set("access-control-allow-headers", "authorization, content-type, mcp-protocol-version");
  return res;
}

function oauthFail(status: number, error: string, description: string): Response {
  return cors(json(status, { error, error_description: description }));
}

async function register(c: Ctx): Promise<Response> {
  let body: unknown;
  try {
    const text = await c.request.text();
    if (text.length > 16 * 1024) return oauthFail(413, "invalid_client_metadata", "registration too large");
    body = JSON.parse(text);
  } catch {
    return oauthFail(400, "invalid_client_metadata", "body must be JSON");
  }
  const input = validate(ClientRegistrationInput, body);
  if (!input.ok)
    return oauthFail(400, input.field.startsWith("redirect_uris") ? "invalid_redirect_uri" : "invalid_client_metadata", input.message);
  const registered = await authStore(c.env).registerOAuthClient(input.value);
  if (registered.status === "error") return oauthFail(400, "invalid_redirect_uri", registered.error.message);
  const client = registered.value;
  return cors(
    json(201, {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: OAUTH_SCOPES.join(" "),
    }),
  );
}

const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "resource",
  "state",
];

function readParams(source: URLSearchParams | FormData) {
  const get = (k: string) => {
    const value = source.get(k);
    return typeof value === "string" ? value : null;
  };
  return {
    raw: Object.fromEntries(AUTHORIZE_PARAMS.flatMap((k) => (get(k) === null ? [] : [[k, get(k)!]]))) as Record<string, string>,
    params: {
      responseType: get("response_type"),
      clientId: get("client_id"),
      redirectUri: get("redirect_uri"),
      codeChallenge: get("code_challenge"),
      codeChallengeMethod: get("code_challenge_method"),
      scope: get("scope"),
      resource: get("resource"),
    },
    state: get("state"),
  };
}

/** Pages the user sees: never framed, never cached, no scripts. */
function html(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      "referrer-policy": "same-origin",
    },
  });
}

function backToClient(redirectUri: string, url: URL, values: Record<string, string | null>): Response {
  const target = new URL(redirectUri);
  for (const [k, v] of Object.entries({ ...values, iss: url.origin })) if (v !== null) target.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: target.toString(), "cache-control": "no-store" } });
}

async function authorizePage(c: Ctx): Promise<Response> {
  const { raw, params, state } = readParams(c.url.searchParams);
  const store = authStore(c.env);
  const checked = await store.checkAuthorize(params, mcpResource(c.url));
  if (!checked.ok) {
    if (!checked.redirect) return html(400, renderOAuthError(checked.description));
    return backToClient(params.redirectUri!, c.url, { error: checked.error, error_description: checked.description, state });
  }
  const session = await signedIn(c.request, c.env);
  if (!session) {
    const next = `${c.url.pathname}${c.url.search}`;
    return new Response(null, { status: 302, headers: { location: `/app/login?next=${encodeURIComponent(next)}` } });
  }
  const workspaces = session.info.memberships;
  if (!workspaces.length) return html(403, renderOAuthError("Your account is not a member of any workspace."));
  return html(
    200,
    renderConsent({
      clientName: checked.request.client.name,
      redirectHost: new URL(checked.request.redirectUri).host || checked.request.redirectUri,
      email: session.info.email,
      workspaces,
      wantsWrite: checked.request.scopes.includes("mcp:write") && workspaces.some((w) => w.role !== "viewer"),
      params: hiddenFields(raw),
    }),
  );
}

/** The consent form carries the request back; the requested scope moves aside so the user's choice can use "scope". */
function hiddenFields(raw: Record<string, string>): Record<string, string> {
  const { scope, ...rest } = raw;
  return scope === undefined ? rest : { ...rest, requested_scope: scope };
}

async function authorizeDecision(c: Ctx): Promise<Response> {
  if (!sameOrigin(c.request, c.url)) return html(403, renderOAuthError("This form must be sent from this site."));
  const form = await c.request.formData();
  const { params, state } = readParams(form);
  const session = await signedIn(c.request, c.env);
  if (!session) return html(401, renderOAuthError("Your session ended. Start connecting again from the app."));
  const store = authStore(c.env);
  const requested = form.get("requested_scope");
  const checked = await store.checkAuthorize({ ...params, scope: typeof requested === "string" ? requested : null }, mcpResource(c.url));
  if (!checked.ok) {
    if (!checked.redirect) return html(400, renderOAuthError(checked.description));
    return backToClient(params.redirectUri!, c.url, { error: checked.error, error_description: checked.description, state });
  }
  if (form.get("decision") !== "allow") {
    return backToClient(checked.request.redirectUri, c.url, { error: "access_denied", error_description: "the user declined", state });
  }
  const workspaceId = String(form.get("workspace") ?? "");
  if (!session.info.memberships.some((m) => m.workspaceId === workspaceId))
    return html(400, renderOAuthError("Pick one of your workspaces."));
  const chosen = String(form.get("scope") ?? "").split(" ");
  const scopes = checked.request.scopes.filter((s: OAuthScope) => s === "mcp:read" || chosen.includes(s));
  const code = await store.approveOAuth(session.info.userId, workspaceId, { ...checked.request, scopes });
  if (code.status === "error") return html(400, renderOAuthError(code.error.message));
  return backToClient(checked.request.redirectUri, c.url, { code: code.value, state });
}

async function readForm(request: Request): Promise<Record<string, string> | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded")) return null;
  if (Number(request.headers.get("content-length") ?? "0") > 8 * 1024) return null;
  const form = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form) if (typeof value === "string") fields[key] = value;
  return fields;
}

async function token(c: Ctx): Promise<Response> {
  const form = await readForm(c.request);
  if (!form) return oauthFail(400, "invalid_request", "send application/x-www-form-urlencoded");
  const store = authStore(c.env);
  const clientId = form.client_id ?? "";
  let result;
  if (form.grant_type === "authorization_code") {
    if (form.resource && form.resource !== mcpResource(c.url))
      return oauthFail(400, "invalid_target", `the only resource here is ${mcpResource(c.url)}`);
    result = await store.exchangeOAuthCode({
      code: form.code ?? "",
      clientId,
      redirectUri: form.redirect_uri ?? "",
      codeVerifier: form.code_verifier ?? "",
    });
  } else if (form.grant_type === "refresh_token") {
    result = await store.refreshOAuth({ refreshToken: form.refresh_token ?? "", clientId });
  } else {
    return oauthFail(400, "unsupported_grant_type", "use authorization_code or refresh_token");
  }
  if (!result.ok) return oauthFail(400, result.error, result.description);
  return cors(json(200, result.tokens, { pragma: "no-cache" }));
}

async function revoke(c: Ctx): Promise<Response> {
  const form = await readForm(c.request);
  if (!form?.token) return oauthFail(400, "invalid_request", "send the token to revoke");
  await authStore(c.env).revokeOAuthToken(form.token);
  return cors(new Response(null, { status: 200 }));
}
