export type MonitorStatus = "up" | "degraded" | "down" | "pending" | "paused";
import { cn } from "../cn";

const COPY: Record<MonitorStatus, string> = { up: "Up", degraded: "Slow", down: "Down", pending: "Pending", paused: "Paused" };
const DOT: Record<MonitorStatus, string> = {
  up: "bg-up",
  degraded: "bg-pending",
  down: "bg-down",
  pending: "bg-paused",
  paused: "bg-paused",
};

/** Status as a dot plus a word, never color alone. A down monitor's dot pulses softly. */
export function StatusBadge({ status, className }: { status: MonitorStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-small font-medium", className)}>
      <StatusDot status={status} />
      {COPY[status]}
    </span>
  );
}

export function StatusDot({ status, className }: { status: MonitorStatus; className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-flex size-2 shrink-0 rounded-full", DOT[status], className)}>
      {status === "down" ? <span className="absolute inset-0 animate-ping rounded-full bg-down opacity-40 motion-reduce:hidden" /> : null}
    </span>
  );
}
