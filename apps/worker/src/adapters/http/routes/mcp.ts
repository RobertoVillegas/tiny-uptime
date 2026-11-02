import * as v from "valibot";
import { handleMessage, parseError } from "../../mcp/protocol";
import { TOOLS } from "../../mcp/tools";
import { readBody } from "../request";
import { failWith, json } from "../respond";
import type { Router } from "../router";
import { workspaceRoute } from "./workspace-route";

/**
 * The MCP server over Streamable HTTP, stateless: every POST carries one JSON-RPC message and gets
 * one JSON answer, so there is no session and no event stream. It authenticates like the REST API.
 */
export function mcpRoutes(router: Router): void {
  router
    .post(
      "/api/mcp",
      workspaceRoute(async (c) => {
        const origin = c.request.headers.get("origin");
        if (origin && origin !== c.url.origin) return failWith(403, "forbidden", "cross-origin request refused");
        const body = await readBody(c.request, v.unknown());
        if (body.isErr()) return json(400, parseError());
        const answer = await handleMessage(body.value, TOOLS, { workspace: c.workspace, principal: c.principal, origin: c.url.origin });
        return answer ? json(200, answer) : new Response(null, { status: 202 });
      }),
    )
    .get("/api/mcp", () => new Response(null, { status: 405, headers: { allow: "POST" } }))
    .delete("/api/mcp", () => new Response(null, { status: 405, headers: { allow: "POST" } }));
}
