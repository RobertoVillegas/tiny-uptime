import * as v from "valibot";
import type { Principal } from "@tiny-uptime/core";
import { handleMessage, parseError } from "../../mcp/protocol";
import { TOOLS } from "../../mcp/tools";
import { cryptoIds } from "../../system";
import { resolveCall, workspaceStub } from "../principal";
import { bearer, readBody } from "../request";
import { failWith, json } from "../respond";
import type { Ctx, Router } from "../router";
import { authStore } from "../session";
import { mcpResource, resourceMetadataUrl } from "./oauth";

const ACCESS_TOKEN = /^tuat_[0-9a-f]{64}$/;

/**
 * The MCP server over Streamable HTTP, stateless: every POST carries one JSON-RPC message and gets
 * one JSON answer, so there is no session and no event stream. Clients sign in with OAuth, or send
 * an API key the way the REST API takes it.
 */
export function mcpRoutes(router: Router): void {
  router
    .post("/api/mcp", async (c) => {
      const origin = c.request.headers.get("origin");
      if (origin && origin !== c.url.origin) return failWith(403, "forbidden", "cross-origin request refused");
      const caller = await resolveCaller(c);
      if ("challenge" in caller) return caller.challenge;
      const body = await readBody(c.request, v.unknown());
      if (body.isErr()) return json(400, parseError());
      const workspace = workspaceStub(c, caller.workspaceId);
      const answer = await handleMessage(body.value, TOOLS, { workspace, principal: caller.principal, origin: c.url.origin });
      return answer ? json(200, answer) : new Response(null, { status: 202 });
    })
    .get("/api/mcp", () => new Response(null, { status: 405, headers: { allow: "POST" } }))
    .delete("/api/mcp", () => new Response(null, { status: 405, headers: { allow: "POST" } }));
}

async function resolveCaller(c: Ctx): Promise<{ workspaceId: string; principal: Principal } | { challenge: Response }> {
  const token = bearer(c.request);
  if (token && ACCESS_TOKEN.test(token)) {
    const owner = await authStore(c.env).oauthAccess(await cryptoIds.hash(token));
    if (!owner || owner.resource !== mcpResource(c.url)) return { challenge: unauthorized(c, "invalid_token") };
    return { workspaceId: owner.workspaceId, principal: { kind: "member", userId: owner.userId, role: owner.role } };
  }
  if (!token && !c.request.headers.get("x-api-key")) return { challenge: unauthorized(c, null) };
  const call = await resolveCall(c);
  return call.isOk() ? call.value : { challenge: unauthorized(c, "invalid_token") };
}

/** 401 with the pointer MCP clients follow to find where to sign in (RFC 9728 §5.1). */
function unauthorized(c: Ctx, error: string | null): Response {
  const params = [
    `resource_metadata="${resourceMetadataUrl(c.url)}"`,
    `scope="mcp:read mcp:write"`,
    ...(error ? [`error="${error}"`] : []),
  ];
  const res = failWith(401, "unauthorized", error ? "the token is invalid, expired or revoked" : "sign in with OAuth or send an API key");
  res.headers.set("www-authenticate", `Bearer ${params.join(", ")}`);
  return res;
}
