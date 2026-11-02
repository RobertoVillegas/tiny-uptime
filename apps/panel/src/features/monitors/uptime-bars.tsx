import type { MonitorStats } from "@tiny-uptime/contracts";
import { cn } from "cn";
import { percent } from "../../lib/format";

type Bin = { from: Date; checks: number; ok: number };

/**
 * One bar per slice of time: hours for a day, four hours for a week, days for a month.
 * Bars with no checks stay neutral, so "no data" never looks like "up".
 */
export function UptimeBars({ stats }: { stats: MonitorStats }) {
  const binHours = stats.hours <= 24 ? 1 : stats.hours <= 168 ? 4 : 24;
  const bins = toBins(stats, binHours);
  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Uptime over the last ${stats.hours} hours: ${percent(stats.uptime)}`}
        className="flex h-10 items-stretch gap-[3px]"
      >
        {bins.map((bin) => (
          <span
            key={bin.from.getTime()}
            title={`${bin.from.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}: ${bin.checks ? `${bin.ok}/${bin.checks} ok` : "no checks"}`}
            className={cn("flex-1 rounded-[2px] transition-opacity duration-150 hover:opacity-70", colorOf(bin))}
          />
        ))}
      </div>
      <div className="flex justify-between text-[0.75rem] text-muted-foreground">
        <span>{stats.hours <= 24 ? "24 hours ago" : stats.hours <= 168 ? "7 days ago" : "30 days ago"}</span>
        <span>Now</span>
      </div>
    </div>
  );
}

function colorOf(bin: Bin): string {
  if (bin.checks === 0) return "bg-subtle";
  if (bin.ok === bin.checks) return "bg-up";
  if (bin.ok === 0) return "bg-down";
  return "bg-pending";
}

function toBins(stats: MonitorStats, binHours: number): Bin[] {
  const hour = 3_600_000;
  const now = Math.floor(Date.now() / hour) * hour;
  const count = Math.ceil(stats.hours / binHours);
  const start = now - (count * binHours - 1) * hour;
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({ from: new Date(start + i * binHours * hour), checks: 0, ok: 0 }));
  for (const point of stats.series) {
    const index = Math.floor((new Date(point.hour).getTime() - start) / (binHours * hour));
    const bin = bins[index];
    if (!bin) continue;
    bin.checks += point.checks;
    bin.ok += point.ok;
  }
  return bins;
}
