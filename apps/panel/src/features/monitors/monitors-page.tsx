import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { isOneOf, type Monitor, type MonitorBulk, type MonitorsActivity } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { CheckboxList, Tick } from "@tiny-uptime/ui/components/checkbox";
import { ConfirmDialog, Dialog } from "@tiny-uptime/ui/components/dialog";
import { Menu } from "@tiny-uptime/ui/components/menu";
import { Select } from "@tiny-uptime/ui/components/select";
import { StatusBadge, StatusDot } from "@tiny-uptime/ui/components/status";
import { EmptyState, Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { notify } from "@tiny-uptime/ui/components/toast";
import { Activity, Bell, Download, Ellipsis, Pause, Play, Plus, Trash2, Upload } from "lucide-react";
import { cn } from "@tiny-uptime/ui/cn";
import { useState } from "react";
import { api, messageOf } from "../../lib/api";
import { ms, timeAgo } from "../../lib/format";
import { activityQuery, channelsQuery, monitorsQuery } from "../../lib/queries";
import { PageHeader } from "../shell/page-header";
import { ActivityChart } from "./activity-chart";
import { ImportDialog } from "./import-dialog";
import { MonitorForm } from "./monitor-form";
import { useBulkMonitors, useCreateMonitor } from "./mutations";
import { targetOf, typeLabel } from "./describe";

export function MonitorsPage() {
  const monitors = useQuery(monitorsQuery());
  const activity = useQuery(activityQuery());
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const create = useCreateMonitor();
  const navigate = useNavigate();
  const [tag, setTag] = useState<string | null>(null);
  const all = monitors.data ?? [];
  const tags = [...new Set(all.flatMap((m) => m.tags))].toSorted();
  const [sort, setSort] = useState<SortKey>(storedSort);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const list = sortMonitors(tag ? all.filter((m) => m.tags.includes(tag)) : all, sort);
  const shown = list.filter((m) => selected.has(m.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

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
              className="h-7 rounded-full border border-border px-3 text-small text-muted-foreground transition-colors duration-150 hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground max-sm:h-9"
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
          <>
            <ListBar
              list={list}
              selected={shown}
              onSelectAll={(on) => setSelected(on ? new Set(list.map((m) => m.id)) : new Set())}
              onDone={() => setSelected(new Set())}
              sort={sort}
              onSort={(next) => {
                setSort(next);
                try {
                  localStorage.setItem(SORT_KEY, next);
                } catch {
                  // Private windows may refuse storage; the sort still applies for this visit.
                }
              }}
            />
            <ul className="divide-y divide-border">
              {list.map((m) => (
                <MonitorRow
                  key={m.id}
                  monitor={m}
                  activity={activity.data}
                  selected={selected.has(m.id)}
                  onSelect={(on) => toggle(m.id, on)}
                />
              ))}
            </ul>
          </>
        )}
      </Section>
    </>
  );
}

function MonitorRow({
  monitor: m,
  activity,
  selected,
  onSelect,
}: {
  monitor: Monitor;
  activity: MonitorsActivity | undefined;
  selected: boolean;
  onSelect: (on: boolean) => void;
}) {
  return (
    <li
      className="flex items-center transition-colors duration-150 has-[a:hover]:bg-subtle aria-selected:bg-subtle/60"
      aria-selected={selected}
    >
      <Tick aria-label={`Select ${m.name}`} checked={selected} onCheckedChange={onSelect} className="ml-5" />
      <Link
        to="/monitors/$monitorId"
        params={{ monitorId: m.id }}
        className="grid min-w-0 flex-1 grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-0.5 py-3.5 pr-5 pl-3 sm:grid-cols-[1fr_7rem_5rem_8rem] md:grid-cols-[1fr_11rem_6.5rem_4.5rem_7rem] md:gap-x-5"
      >
        <StatusDot status={m.status} className="sm:hidden" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{m.name}</span>
          <span className="truncate text-small text-muted-foreground">
            {typeLabel(m.type)}
            {targetOf(m) ? ` · ${targetOf(m)}` : ""}
            {m.tags.length ? ` · ${m.tags.join(", ")}` : ""}
          </span>
        </span>
        {activity ? (
          <ActivityChart series={activity.monitors[m.id]} hours={activity.hours} className="hidden md:block" />
        ) : (
          <span className="hidden md:block" />
        )}
        <StatusBadge status={m.status} className="hidden sm:inline-flex" />
        <span className="hidden text-right text-small text-muted-foreground tabular-nums sm:block">
          {m.type === "heartbeat" ? "" : ms(m.lastLatencyMs)}
        </span>
        <span className="text-right text-small text-muted-foreground tabular-nums">{m.paused ? "Paused" : timeAgo(m.lastCheckedAt)}</span>
      </Link>
    </li>
  );
}

const SORT_KEY = "tiny-uptime.monitors.sort";
const SORTS = [
  { value: "status", label: "Down first" },
  { value: "name", label: "Name" },
  { value: "latency", label: "Slowest first" },
  { value: "checked", label: "Last checked" },
] as const;
type SortKey = (typeof SORTS)[number]["value"];
const STATUS_ORDER: Record<Monitor["status"], number> = { down: 0, degraded: 1, pending: 2, up: 3, paused: 4 };

/** The sort kept in this browser, or down first. */
function storedSort(): SortKey {
  try {
    const stored = localStorage.getItem(SORT_KEY);
    return isOneOf(
      SORTS.map((s) => s.value),
      stored,
    )
      ? stored
      : "status";
  } catch {
    return "status";
  }
}

const byName = (a: Monitor, b: Monitor) => a.name.localeCompare(b.name);

function sortMonitors(list: Monitor[], sort: SortKey): Monitor[] {
  return list.toSorted((a, b) => {
    switch (sort) {
      case "status":
        return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byName(a, b);
      case "name":
        return byName(a, b);
      case "latency":
        return (b.lastLatencyMs ?? -1) - (a.lastLatencyMs ?? -1) || byName(a, b);
      case "checked":
        return (b.lastCheckedAt ?? "").localeCompare(a.lastCheckedAt ?? "") || byName(a, b);
    }
  });
}

/** Select all and the sort; with monitors ticked, what to do with them. */
function ListBar({
  list,
  selected,
  onSelectAll,
  onDone,
  sort,
  onSort,
}: {
  list: Monitor[];
  selected: Monitor[];
  onSelectAll: (on: boolean) => void;
  onDone: () => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
}) {
  const bulk = useBulkMonitors();
  const [deleting, setDeleting] = useState(false);
  const [routing, setRouting] = useState(false);
  const ids = selected.map((m) => m.id);
  const run = async (change: Omit<MonitorBulk, "ids">) => {
    await bulk.mutateAsync({ ids, ...change });
    onDone();
  };
  const all = selected.length > 0 && selected.length === list.length;
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border py-2 pr-3 pl-5">
      <Tick
        aria-label={selected.length ? "Clear selection" : "Select all monitors"}
        checked={all}
        indeterminate={selected.length > 0 && !all}
        onCheckedChange={() => onSelectAll(selected.length === 0)}
      />
      {selected.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-small tabular-nums">{selected.length} selected</span>
          <Button
            size="sm"
            variant="secondary"
            loading={bulk.isPending && bulk.variables?.action === "pause"}
            onClick={() => void run({ action: "pause" })}
          >
            <Pause />
            <span className="max-sm:sr-only">Pause</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={bulk.isPending && bulk.variables?.action === "resume"}
            onClick={() => void run({ action: "resume" })}
          >
            <Play />
            <span className="max-sm:sr-only">Resume</span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setRouting(true)}>
            <Bell />
            <span className="max-sm:sr-only">Alert channels…</span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDeleting(true)}>
            <Trash2 />
            <span className="max-sm:sr-only">Delete</span>
          </Button>
        </div>
      ) : (
        <span className="text-small text-muted-foreground">
          {list.length} {list.length === 1 ? "monitor" : "monitors"}
        </span>
      )}
      <div className={cn("ml-auto w-40", selected.length ? "max-sm:hidden" : "")}>
        <Select label="Sort monitors" labelTrigger value={sort} onValueChange={onSort} options={SORTS} />
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${selected.length} ${selected.length === 1 ? "monitor" : "monitors"}?`}
        description="Their checks, history and incidents are deleted too. This cannot be undone."
        confirmLabel="Delete"
        pending={bulk.isPending}
        onConfirm={async () => {
          await run({ action: "delete" });
          setDeleting(false);
        }}
      />
      <ChannelsDialog
        open={routing}
        onOpenChange={setRouting}
        count={selected.length}
        pending={bulk.isPending}
        onSave={async (channelIds) => {
          await run({ action: "set_channels", channelIds });
          setRouting(false);
        }}
      />
    </div>
  );
}

function ChannelsDialog({
  open,
  onOpenChange,
  count,
  pending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  pending: boolean;
  onSave: (channelIds: string[]) => Promise<void>;
}) {
  const channels = useQuery(channelsQuery());
  const [chosen, setChosen] = useState<string[]>([]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Alert channels"
      description={`The ${count === 1 ? "monitor alerts" : `${count} monitors alert`} the channels ticked here. With none ticked, they alert every channel.`}
    >
      <div className="flex flex-col gap-5">
        {channels.data?.length ? (
          <CheckboxList value={chosen} onValueChange={setChosen} options={channels.data.map((c) => ({ value: c.id, label: c.name }))} />
        ) : (
          <p className="text-small text-muted-foreground">No alert channels yet. Add one under Alerts.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void onSave(chosen)}>
            {chosen.length ? "Use these channels" : "Alert every channel"}
          </Button>
        </div>
      </div>
    </Dialog>
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
