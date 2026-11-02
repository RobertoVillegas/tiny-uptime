import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { StatusDot } from "@tiny-uptime/ui/components/status";
import { EmptyState, Skeleton } from "@tiny-uptime/ui/components/surface";
import { CircleCheck } from "lucide-react";
import { dateTime, duration } from "../../lib/format";
import { incidentsQuery } from "../../lib/queries";

/** Incidents newest first: ongoing ones say so, resolved ones say how long they lasted. */
export function IncidentList({
  monitorId,
  emptyText,
  showMonitor = false,
}: {
  monitorId?: string;
  emptyText: string;
  showMonitor?: boolean;
}) {
  const incidents = useQuery(incidentsQuery(monitorId));
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
        <li key={i.id} className="flex items-start gap-3 px-5 py-3.5">
          <StatusDot status={i.resolvedAt ? "up" : "down"} className="mt-1.5" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="font-medium">
              {showMonitor ? (
                <Link to="/monitors/$monitorId" params={{ monitorId: i.monitorId }} className="hover:underline hover:underline-offset-4">
                  {i.monitorName ?? "Deleted monitor"}
                </Link>
              ) : null}
              {showMonitor ? <span className="font-normal text-muted-foreground"> · </span> : null}
              <span className={showMonitor ? "font-normal" : ""}>{i.cause}</span>
            </p>
            <p className="text-[0.8125rem] text-muted-foreground">
              {dateTime(i.startedAt)} ·{" "}
              {i.resolvedAt ? `resolved after ${duration(i.startedAt, i.resolvedAt)}` : `ongoing for ${duration(i.startedAt, null)}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
