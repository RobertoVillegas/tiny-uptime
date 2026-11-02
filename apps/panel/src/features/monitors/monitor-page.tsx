import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { Monitor } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { CopyButton } from "@tiny-uptime/ui/components/copy-button";
import { ConfirmDialog, Dialog } from "@tiny-uptime/ui/components/dialog";
import { Menu } from "@tiny-uptime/ui/components/menu";
import { StatusBadge } from "@tiny-uptime/ui/components/status";
import { Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { Segmented } from "@tiny-uptime/ui/components/tabs";
import { notify } from "@tiny-uptime/ui/components/toast";
import { ChevronLeft, Ellipsis, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { ms, percent, timeAgo } from "../../lib/format";
import { monitorQuery, statsQuery } from "../../lib/queries";
import { monitorRoute } from "../../router";
import { IncidentList } from "../incidents/incident-list";
import { NotFound } from "../shell/not-found";
import { targetOf, typeLabel, every } from "./describe";
import { MonitorForm } from "./monitor-form";
import { useDeleteMonitor, usePauseMonitor, useUpdateMonitor } from "./mutations";
import { UptimeBars } from "./uptime-bars";

const RANGES = [
  { value: "24", label: "24 hours" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
] as const;

export function MonitorPage() {
  const { monitorId } = monitorRoute.useParams();
  const monitor = useQuery(monitorQuery(monitorId));
  if (monitor.isError) return <NotFound />;
  if (!monitor.data) return <DetailSkeleton />;
  return <Detail monitor={monitor.data} />;
}

function Detail({ monitor: m }: { monitor: Monitor }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("24");
  const [editing, setEditing] = useState(false);
  const stats = useQuery(statsQuery(m.id, Number(range)));
  const update = useUpdateMonitor(m.id);
  const pause = usePauseMonitor(m.id);
  const remove = useDeleteMonitor();
  const navigate = useNavigate();

  return (
    <>
      <Link to="/monitors" className="mb-4 inline-flex items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        Monitors
      </Link>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-balance">{m.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted-foreground">
            <StatusBadge status={m.status} className="text-foreground" />
            <span>
              {typeLabel(m.type)} · {targetOf(m)}
            </span>
            <span>{m.status === "paused" ? "Paused" : `Checked ${timeAgo(m.lastCheckedAt)}`}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </Button>
          <Menu
            trigger={
              <Button variant="secondary" size="icon" aria-label="More actions">
                <Ellipsis />
              </Button>
            }
            actions={[
              m.paused
                ? { label: "Resume checks", icon: <Play />, onClick: () => pause.mutate(false) }
                : { label: "Pause checks", icon: <Pause />, onClick: () => pause.mutate(true) },
            ]}
          />
        </div>
      </header>

      <Dialog open={editing} onOpenChange={setEditing} title={`Edit ${m.name}`}>
        <MonitorForm
          monitor={m}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (draft) => {
            const { type: _type, ...changes } = draft;
            await update.mutateAsync(changes);
            setEditing(false);
            notify("Changes saved", { type: "success" });
          }}
        />
      </Dialog>

      <div className="flex flex-col gap-6">
        <Section title="Availability" actions={<Segmented label="Time range" value={range} onValueChange={setRange} options={RANGES} />}>
          <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3">
            <Stat label="Uptime" value={stats.data ? percent(stats.data.uptime) : null} />
            <Stat label="Average response" value={stats.data ? (m.type === "heartbeat" ? "—" : ms(stats.data.avgLatencyMs)) : null} />
            <Stat
              label={m.type === "heartbeat" ? "Last ping" : "Last check"}
              value={m.lastDetail ?? "Waiting for the first check"}
              className="col-span-2 sm:col-span-1"
            />
          </div>
          <div className="p-5">{stats.data ? <UptimeBars stats={stats.data} /> : <Skeleton className="h-10 w-full" />}</div>
        </Section>

        {m.heartbeatUrl ? (
          <Section
            title="Heartbeat URL"
            description={`Send a GET or POST at least every ${every(m.intervalSec)}. It goes down when none arrives within the grace period.`}
          >
            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 truncate rounded-control bg-subtle px-3 py-2 font-mono text-[0.8125rem]">
                {m.heartbeatUrl}
              </code>
              <CopyButton text={m.heartbeatUrl} label="Copy URL" />
            </div>
          </Section>
        ) : null}

        <Section title="Incidents">
          <IncidentList monitorId={m.id} emptyText="No incidents. This monitor has not gone down since it was created." />
        </Section>

        <Section title="Danger zone">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-muted-foreground">Deleting removes the monitor, its history and its incidents.</p>
            <ConfirmDialog
              trigger={
                <Button variant="secondary" className="text-down">
                  <Trash2 />
                  Delete monitor
                </Button>
              }
              title={`Delete ${m.name}?`}
              description="Its history and incidents are deleted too. This cannot be undone."
              confirmLabel="Delete monitor"
              pending={remove.isPending}
              onConfirm={async () => {
                await remove.mutateAsync(m.id);
                notify(`${m.name} deleted`);
                await navigate({ to: "/monitors" });
              }}
            />
          </div>
        </Section>
      </div>
    </>
  );
}

function Stat({ label, value, className }: { label: string; value: string | null; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 bg-surface px-5 py-4 ${className ?? ""}`}>
      <span className="text-[0.8125rem] text-muted-foreground">{label}</span>
      {value === null ? <Skeleton className="h-6 w-20" /> : <span className="truncate text-lg font-semibold tabular-nums">{value}</span>}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
