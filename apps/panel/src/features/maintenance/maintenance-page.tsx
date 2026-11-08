import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Maintenance } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { ConfirmDialog, Dialog } from "@tiny-uptime/ui/components/dialog";
import { EmptyState, Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { notify } from "@tiny-uptime/ui/components/toast";
import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { maintenanceQuery, monitorsQuery } from "../../lib/queries";
import { PageHeader } from "../shell/page-header";
import { MaintenanceForm } from "./maintenance-form";
import { hourOptions } from "../../lib/clock";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MaintenancePage() {
  const windows = useQuery(maintenanceQuery());
  const [editing, setEditing] = useState<Maintenance | "new" | null>(null);
  const list = windows.data ?? [];
  const current = list.filter((w) => !w.finished);
  const past = list.filter((w) => w.finished);

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="During a window, checks keep running but no incidents open and nobody is alerted."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus />
            Schedule maintenance
          </Button>
        }
      />
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "new" ? "Schedule maintenance" : "Edit maintenance"}
      >
        {editing ? <MaintenanceForm window={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} /> : null}
      </Dialog>
      <div className="flex flex-col gap-6">
        <Section title="Scheduled and active">
          {windows.isPending ? (
            <div className="p-5">
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : current.length === 0 ? (
            <EmptyState
              icon={<CalendarClock />}
              title="Nothing scheduled"
              description="Schedule a window before a deploy or migration so planned downtime does not page anyone."
            />
          ) : (
            <WindowList windows={current} onEdit={setEditing} />
          )}
        </Section>
        {past.length ? (
          <Section title="Past">
            <WindowList windows={past} onEdit={setEditing} />
          </Section>
        ) : null}
      </div>
    </>
  );
}

function WindowList({ windows, onEdit }: { windows: Maintenance[]; onEdit: (w: Maintenance) => void }) {
  const monitors = useQuery(monitorsQuery());
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.maintenance.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: maintenanceQuery().queryKey });
      notify("Maintenance deleted");
    },
  });
  const names = (ids: string[]) =>
    ids.length === 0 ? "All monitors" : ids.map((id) => monitors.data?.find((m) => m.id === id)?.name ?? "Deleted monitor").join(", ");

  return (
    <ul className="divide-y divide-border">
      {windows.map((w) => (
        <li key={w.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2 font-medium">
              {w.name}
              {w.active ? (
                <span className="rounded-full bg-pending/20 px-2 py-0.5 text-caption font-medium text-foreground">In progress</span>
              ) : null}
            </span>
            <span className="text-small text-muted-foreground">{schedule(w)}</span>
            <span className="truncate text-small text-muted-foreground">{names(w.monitorIds)}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onEdit(w)}>
            <Pencil />
            Edit
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="text-down" aria-label={`Delete ${w.name}`}>
                <Trash2 />
              </Button>
            }
            title={`Delete ${w.name}?`}
            description="Monitors it covers alert normally again."
            confirmLabel="Delete maintenance"
            pending={remove.isPending}
            onConfirm={() => remove.mutateAsync(w.id)}
          />
        </li>
      ))}
    </ul>
  );
}

/** "Sundays 02:00–03:00 (America/Mexico_City)" or "Nov 8, 10:00 – Nov 8, 11:00". */
function schedule(w: Maintenance): string {
  const tz = w.recurrence?.timezone;
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleString(undefined, { ...opts, ...hourOptions(), ...(tz ? { timeZone: tz } : {}) });
  if (!w.recurrence)
    return `${fmt(w.startsAt, { dateStyle: "medium", timeStyle: "short" })} – ${fmt(w.endsAt, { dateStyle: "medium", timeStyle: "short" })}`;
  const times = `${fmt(w.startsAt, { timeStyle: "short" })}–${fmt(w.endsAt, { timeStyle: "short" })}`;
  const days = w.recurrence.frequency === "daily" ? "Every day" : (w.recurrence.days ?? []).map((d) => WEEKDAYS[d]).join(", ");
  return `${days}, ${times} (${w.recurrence.timezone})${w.recurrence.until ? ` until ${fmt(w.recurrence.until, { dateStyle: "medium" })}` : ""}`;
}
