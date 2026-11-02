import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { Monitor } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { Dialog } from "@tiny-uptime/ui/components/dialog";
import { Menu } from "@tiny-uptime/ui/components/menu";
import { StatusBadge, StatusDot } from "@tiny-uptime/ui/components/status";
import { EmptyState, Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { notify } from "@tiny-uptime/ui/components/toast";
import { Activity, Download, Ellipsis, Plus, Upload } from "lucide-react";
import { useState } from "react";
import { api, messageOf } from "../../lib/api";
import { ms, timeAgo } from "../../lib/format";
import { monitorsQuery } from "../../lib/queries";
import { PageHeader } from "../shell/page-header";
import { ImportDialog } from "./import-dialog";
import { MonitorForm } from "./monitor-form";
import { useCreateMonitor } from "./mutations";
import { targetOf, typeLabel } from "./describe";

export function MonitorsPage() {
  const monitors = useQuery(monitorsQuery());
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const create = useCreateMonitor();
  const navigate = useNavigate();
  const [tag, setTag] = useState<string | null>(null);
  const all = monitors.data ?? [];
  const tags = [...new Set(all.flatMap((m) => m.tags))].toSorted();
  const list = tag ? all.filter((m) => m.tags.includes(tag)) : all;

  return (
    <>
      <PageHeader
        title="Monitors"
        description={monitors.data ? summary(all) : " "}
        actions={
          <div className="flex gap-2">
            <Menu
              trigger={
                <Button variant="secondary" size="icon" aria-label="Import and export">
                  <Ellipsis />
                </Button>
              }
              actions={[
                { label: "Import monitors…", icon: <Upload />, onClick: () => setImporting(true) },
                { label: "Export as JSON", icon: <Download />, onClick: () => void exportMonitors() },
              ]}
            />
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus />
              New monitor
            </Button>
          </div>
        }
      />
      <ImportDialog open={importing} onOpenChange={setImporting} />
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New monitor"
        description="Checks start right away; heartbeats wait for their first ping."
      >
        <MonitorForm
          submitLabel="Create monitor"
          onCancel={() => setCreating(false)}
          onSubmit={async (draft) => {
            const monitor = await create.mutateAsync(draft);
            setCreating(false);
            notify(`${monitor.name} created`, { type: "success" });
            await navigate({ to: "/monitors/$monitorId", params: { monitorId: monitor.id } });
          }}
        />
      </Dialog>

      {tags.length ? (
        <div role="group" aria-label="Filter by tag" className="mb-3 flex flex-wrap gap-1.5">
          {[null, ...tags].map((t) => (
            <button
              key={t ?? "all"}
              type="button"
              aria-pressed={tag === t}
              onClick={() => setTag(t)}
              className="h-7 rounded-full border border-border px-3 text-[0.8125rem] text-muted-foreground transition-colors duration-150 hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground max-sm:h-9"
            >
              {t ?? "All"}
            </button>
          ))}
        </div>
      ) : null}
      <Section>
        {monitors.isPending ? (
          <ListSkeleton />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Activity />}
            title="No monitors yet"
            description="Add a website, an API, a TCP port or a heartbeat from a cron job, and you will get alerts when it goes down."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus />
                Add your first monitor
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.map((m) => (
              <MonitorRow key={m.id} monitor={m} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function MonitorRow({ monitor: m }: { monitor: Monitor }) {
  return (
    <li>
      <Link
        to="/monitors/$monitorId"
        params={{ monitorId: m.id }}
        className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-0.5 px-5 py-3.5 transition-colors duration-150 hover:bg-subtle sm:grid-cols-[1fr_7rem_5rem_8rem]"
      >
        <StatusDot status={m.status} className="sm:hidden" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{m.name}</span>
          <span className="truncate text-[0.8125rem] text-muted-foreground">
            {typeLabel(m.type)}
            {targetOf(m) ? ` · ${targetOf(m)}` : ""}
            {m.tags.length ? ` · ${m.tags.join(", ")}` : ""}
          </span>
        </span>
        <StatusBadge status={m.status} className="hidden sm:inline-flex" />
        <span className="hidden text-right text-[0.8125rem] text-muted-foreground tabular-nums sm:block">
          {m.type === "heartbeat" ? "" : ms(m.lastLatencyMs)}
        </span>
        <span className="text-right text-[0.8125rem] text-muted-foreground tabular-nums">
          {m.paused ? "Paused" : timeAgo(m.lastCheckedAt)}
        </span>
      </Link>
    </li>
  );
}

/** One line that says what matters first: anything down, then what is still waiting or paused. */
function summary(list: Monitor[]): string {
  if (list.length === 0) return "Nothing is being watched yet.";
  const count = (status: Monitor["status"]) => list.filter((m) => m.status === status).length;
  const parts = [
    count("down") ? `${count("down")} down` : null,
    count("up") ? `${count("up")} up` : null,
    count("pending") ? `${count("pending")} waiting for a check` : null,
    count("paused") ? `${count("paused")} paused` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-border" aria-busy>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <Skeleton className="size-2 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Downloads every monitor as JSON, in the shape Import reads back. */
async function exportMonitors() {
  try {
    const data = await api.monitors.exportAll();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    link.download = `tiny-uptime-monitors-${data.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    notify("Could not export", { type: "error", description: messageOf(error) });
  }
}
