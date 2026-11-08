import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { Button } from "@tiny-uptime/ui/components/button";
import { Menu } from "@tiny-uptime/ui/components/menu";
import { cn } from "@tiny-uptime/ui/cn";
import { Activity, Bell, CalendarClock, ChevronsUpDown, Globe, Settings, TriangleAlert, UserRound, LogOut } from "lucide-react";
import { api, currentWorkspaceId, setCurrentWorkspace } from "../../lib/api";
import { authedRoute } from "../../router";
import { Logo } from "./logo";

const NAV = [
  { to: "/monitors", label: "Monitors", icon: Activity },
  { to: "/incidents", label: "Incidents", icon: TriangleAlert },
  { to: "/status-pages", label: "Status pages", icon: Globe },
  { to: "/maintenance", label: "Maintenance", icon: CalendarClock },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

/** Signed-in layout: navigation and workspace on the side (top on phones), the page beside it. */
export function AppShell() {
  const { me } = authedRoute.useRouteContext();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 z-30 flex flex-col gap-4 border-b border-border bg-background/90 px-3 py-3 backdrop-blur lg:h-dvh lg:border-r lg:border-b-0 lg:px-3 lg:py-5">
        <div className="flex items-center justify-between gap-2 px-2 lg:flex-col lg:items-stretch lg:gap-5">
          <Link to="/monitors" aria-label="tiny-uptime home">
            <Logo />
          </Link>
          <WorkspaceSwitcher />
        </div>
        <nav aria-label="Main" className="grid grid-cols-3 gap-1 lg:flex lg:flex-col">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-caption text-muted-foreground transition-colors duration-150 hover:bg-subtle hover:text-foreground data-[status=active]:bg-subtle data-[status=active]:font-medium data-[status=active]:text-foreground lg:h-9 lg:min-h-0 lg:flex-row lg:justify-start lg:gap-2.5 lg:px-2.5 lg:text-sm [&_svg]:size-4"
            >
              <Icon aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden lg:block">
          <AccountMenu name={me.name} email={me.email} />
        </div>
      </aside>
      <main id="content" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
        <Outlet />
        <div className="mt-10 lg:hidden">
          <AccountMenu name={me.name} email={me.email} />
        </div>
      </main>
    </div>
  );
}

function WorkspaceSwitcher() {
  const { me } = authedRoute.useRouteContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const current = me.memberships.find((m) => m.workspaceId === currentWorkspaceId()) ?? me.memberships[0];
  if (!current) return <span className="text-small text-muted-foreground">No workspace</span>;
  if (me.memberships.length === 1)
    return <span className="truncate px-0.5 text-small text-muted-foreground lg:px-0">{current.workspaceName}</span>;
  return (
    <Menu
      align="start"
      trigger={
        <Button variant="secondary" size="sm" className="max-w-48 justify-between lg:w-full lg:max-w-none">
          <span className="truncate">{current.workspaceName}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      }
      actions={me.memberships.map((m) => ({
        label: m.workspaceName,
        onClick: async () => {
          setCurrentWorkspace(m.workspaceId);
          queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
          await router.invalidate();
        },
      }))}
    />
  );
}

function AccountMenu({ name, email }: { name: string; email: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-150 hover:bg-subtle",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-small font-medium" aria-hidden>
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{name}</span>
            <span className="truncate text-small text-muted-foreground">{email}</span>
          </span>
        </button>
      }
      actions={[
        { label: "Account and security", icon: <UserRound />, onClick: () => void navigate({ to: "/account" }) },
        "separator",
        {
          label: "Sign out",
          icon: <LogOut />,
          onClick: async () => {
            await api.auth.logout();
            queryClient.clear();
            await navigate({ to: "/login", search: {} });
          },
        },
      ]}
    />
  );
}
