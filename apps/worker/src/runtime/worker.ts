import { failWith } from "../adapters/http/respond";
import { Router } from "../adapters/http/router";
import { adminRoutes } from "../adapters/http/routes/admin";
import { apiKeyRoutes } from "../adapters/http/routes/api-keys";
import { accountRoutes } from "../adapters/http/routes/auth-account";
import { signInRoutes } from "../adapters/http/routes/auth-sign-in";
import { channelRoutes } from "../adapters/http/routes/channels";
import { incidentRoutes } from "../adapters/http/routes/incidents";
import { monitorRoutes } from "../adapters/http/routes/monitors";
import { panelRoutes } from "../adapters/http/routes/panel";
import { publicRoutes } from "../adapters/http/routes/public";
import type { Env } from "./env";

export { AuthStore } from "./auth-object";
export { Directory } from "./directory-object";
export { Workspace } from "./workspace-object";

const router = new Router();
for (const register of [
  publicRoutes,
  panelRoutes,
  adminRoutes,
  monitorRoutes,
  incidentRoutes,
  channelRoutes,
  apiKeyRoutes,
  signInRoutes,
  accountRoutes,
]) {
  register(router);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const match = router.match(request, url);
    if ("status" in match) return failWith(match.status, "not_found", match.status === 405 ? "method not allowed" : "not found");
    return match.handler({ request, env, url, params: match.params });
  },
} satisfies ExportedHandler<Env>;
