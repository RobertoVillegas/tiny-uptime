import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Incident } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { StatusDot } from "@tiny-uptime/ui/components/status";
import { EmptyState, Skeleton } from "@tiny-uptime/ui/components/surface";
import { notify } from "@tiny-uptime/ui/components/toast";
import { Check, CircleCheck } from "lucide-react";
import { useCallback } from "react";
import { api, currentWorkspaceId } from "../../lib/api";
import { dateTime, duration } from "../../lib/format";
import { incidentsQuery } from "../../lib/queries";
import { IncidentUpdatesDialog } from "./incident-updates";
import { authedRoute } from "../../router";

/** Incidents newest first: ongoing ones say so and can be acknowledged, resolved ones say how long they lasted. */
export function IncidentList({
  monitorId,
  emptyText,
  showMonitor = false,
  focusId,
}: {
  monitorId?: string;
  emptyText: string;
  showMonitor?: boolean;
  /** An incident to highlight and scroll to, as alerts link to it. */
  focusId?: string;
}) {
  const incidents = useQuery(incidentsQuery(monitorId));
  const { me } = authedRoute.useRouteContext();
  const canWrite = me.memberships.find((m) => m.workspaceId === currentWorkspaceId())?.role !== "viewer";
  if (incidents.isPending) {
    return (
      <div className="flex flex-col gap-3 p-5" aria-busy>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  const list = incidents.data ?? [];
  if (list.length === 0) return <EmptyState icon={<CircleCheck />} title="All clear" description={emptyText} />;
  return (
    <ul className="divide-y divide-border">
      {list.map((i) => (
        <IncidentRow key={i.id} incident={i} showMonitor={showMonitor} canAcknowledge={canWrite} focused={i.id === focusId} />
      ))}
    </ul>
  );
}

function IncidentRow({
  incident: i,
  showMonitor,
  canAcknowledge,
  focused,
}: {
  incident: Incident;
  showMonitor: boolean;
  canAcknowledge: boolean;
  focused: boolean;
}) {
  const scrollTo = useCallback(
    (el: HTMLLIElement | null) => {
      if (el && focused) el.scrollIntoView({ block: "center" });
    },
    [focused],
  );
  const queryClient = useQueryClient();
  const acknowledge = useMutation({
    mutationFn: () => api.incidents.acknowledge(i.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === currentWorkspaceId() && q.queryKey[1] === "incidents" });
      notify("Acknowledged", { description: "Reminders and escalation stop for this incident.", type: "success" });
    },
  });
  const open = i.resolvedAt === null;
  return (
    <li
      ref={scrollTo}
      aria-current={focused ? "true" : undefined}
      className="flex flex-wrap items-start gap-3 px-5 py-3.5 aria-[current]:bg-subtle aria-[current]:shadow-[inset_3px_0_0_var(--color-primary)]"
    >
      <StatusDot status={open ? (i.kind === "slow" ? "degraded" : "down") : "up"} className="mt-1.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-medium">
          {showMonitor ? (
            <>
              <Link to="/monitors/$monitorId" params={{ monitorId: i.monitorId }} className="hover:underline hover:underline-offset-4">
                {i.monitorName ?? "Deleted monitor"}
              </Link>
              <span className="font-normal text-muted-foreground"> · </span>
            </>
          ) : null}
          {i.kind === "slow" ? <span className="mr-1.5 rounded-full bg-subtle px-1.5 py-px text-[0.75rem] font-medium">Slow</span> : null}
          <span className={showMonitor ? "font-normal" : ""}>{i.cause}</span>
        </p>
        <p className="text-[0.8125rem] text-muted-foreground">
          {dateTime(i.startedAt)} ·{" "}
          {open ? `ongoing for ${duration(i.startedAt, null)}` : `resolved after ${duration(i.startedAt, i.resolvedAt)}`}
          {i.acknowledgedAt ? " · acknowledged" : ""}
          {i.notified ? "" : " · not alerted, its dependency was down"}
        </p>
      </div>
      <IncidentUpdatesDialog incident={i} canWrite={canAcknowledge} />
      {open && !i.acknowledgedAt && i.notified && canAcknowledge ? (
        <Button size="sm" loading={acknowledge.isPending} onClick={() => acknowledge.mutate()}>
          <Check />
          Acknowledge
        </Button>
      ) : null}
    </li>
  );
}
