import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from "@tanstack/react-router";
import * as v from "valibot";
import { AppShell } from "./features/shell/app-shell";
import { NotFound } from "./features/shell/not-found";
import { currentWorkspaceId, isUnauthorized, setCurrentWorkspace } from "./lib/api";
import { meQuery } from "./lib/queries";

const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet, notFoundComponent: NotFound });

const login = createRoute({
  getParentRoute: () => root,
  path: "/login",
  validateSearch: v.object({ next: v.optional(v.string()) }),
  component: lazyRouteComponent(() => import("./features/auth/login-page"), "LoginPage"),
});
const invite = createRoute({
  getParentRoute: () => root,
  path: "/invite",
  validateSearch: v.object({ token: v.optional(v.string(), "") }),
  component: lazyRouteComponent(() => import("./features/auth/invite-page"), "InvitePage"),
});
const recover = createRoute({
  getParentRoute: () => root,
  path: "/recover",
  component: lazyRouteComponent(() => import("./features/auth/recover-page"), "RecoverPage"),
});

/** Everything inside needs a complete sign-in and a workspace to act on. */
const authed = createRoute({
  getParentRoute: () => root,
  id: "authed",
  component: AppShell,
  beforeLoad: async ({ context, location }) => {
    try {
      const me = await context.queryClient.ensureQueryData(meQuery);
      const chosen = me.memberships.find((m) => m.workspaceId === currentWorkspaceId()) ?? me.memberships[0];
      if (chosen && chosen.workspaceId !== currentWorkspaceId()) setCurrentWorkspace(chosen.workspaceId);
      return { me };
    } catch (error) {
      if (isUnauthorized(error)) throw redirect({ to: "/login", search: { next: location.href } });
      throw error;
    }
  },
});

const index = createRoute({ getParentRoute: () => authed, path: "/", beforeLoad: () => redirect({ to: "/monitors" }) });
const monitors = createRoute({
  getParentRoute: () => authed,
  path: "/monitors",
  component: lazyRouteComponent(() => import("./features/monitors/monitors-page"), "MonitorsPage"),
});
const monitor = createRoute({
  getParentRoute: () => authed,
  path: "/monitors/$monitorId",
  component: lazyRouteComponent(() => import("./features/monitors/monitor-page"), "MonitorPage"),
});
const incidents = createRoute({
  getParentRoute: () => authed,
  path: "/incidents",
  component: lazyRouteComponent(() => import("./features/incidents/incidents-page"), "IncidentsPage"),
});
const statusPages = createRoute({
  getParentRoute: () => authed,
  path: "/status-pages",
  component: lazyRouteComponent(() => import("./features/status-pages/status-pages-page"), "StatusPagesPage"),
});
const statusPage = createRoute({
  getParentRoute: () => authed,
  path: "/status-pages/$pageId",
  component: lazyRouteComponent(() => import("./features/status-pages/status-page-editor"), "StatusPageEditor"),
});
const maintenance = createRoute({
  getParentRoute: () => authed,
  path: "/maintenance",
  component: lazyRouteComponent(() => import("./features/maintenance/maintenance-page"), "MaintenancePage"),
});
const channels = createRoute({
  getParentRoute: () => authed,
  path: "/alerts",
  component: lazyRouteComponent(() => import("./features/channels/channels-page"), "ChannelsPage"),
});
const settings = createRoute({
  getParentRoute: () => authed,
  path: "/settings",
  component: lazyRouteComponent(() => import("./features/settings/settings-page"), "SettingsPage"),
});
const account = createRoute({
  getParentRoute: () => authed,
  path: "/account",
  component: lazyRouteComponent(() => import("./features/account/account-page"), "AccountPage"),
});

const routeTree = root.addChildren([
  login,
  invite,
  recover,
  authed.addChildren([index, monitors, monitor, incidents, statusPages, statusPage, maintenance, channels, settings, account]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    basepath: "/app",
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultPendingMinMs: 0,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

export const monitorRoute = monitor;
export const authedRoute = authed;
export const inviteRoute = invite;
export const loginRoute = login;
export const statusPageRoute = statusPage;
