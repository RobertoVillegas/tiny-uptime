import type { Incident, MonitorStats } from "@tiny-uptime/contracts";
import { HoverCard } from "@tiny-uptime/ui/components/hover-card";
import { cn } from "@tiny-uptime/ui/cn";
import { duration, percent } from "../../lib/format";
import { hourOptions } from "../../lib/clock";

const HOUR = 3_600_000;

type Bin = {
  from: number;
  to: number;
  checks: number;
  ok: number;
  latencySum: number;
  latencyChecks: number;
  min: number | null;
  max: number | null;
};

/**
 * One bar per slice of time: hours for a day, four hours for a week, days for a month. Bars with
 * no checks stay neutral, so "no data" never looks like "up". Each bar opens its details.
 */
export function UptimeBars({ stats, incidents = [] }: { stats: MonitorStats; incidents?: Incident[] }) {
  const binHours = stats.hours <= 24 ? 1 : stats.hours <= 168 ? 4 : 24;
  const bins = toBins(stats, binHours);
  return (
    <div className="flex flex-col gap-2">
      <div
        aria-label={`Uptime over the last ${stats.hours} hours: ${percent(stats.uptime)}`}
        role="group"
        className="flex h-10 items-stretch gap-0.75"
      >
        {bins.map((bin) => (
          <HoverCard
            key={bin.from}
            trigger={
              <button
                type="button"
                aria-label={`${range(bin)}: ${bin.checks ? `${percent(bin.ok / bin.checks)} up` : "no checks"}`}
                className={cn(
                  "flex-1 rounded-xs outline-offset-1 transition-opacity duration-100 hover:opacity-75 data-popup-open:opacity-75",
                  colorOf(bin),
                )}
              />
            }
          >
            <BinDetails bin={bin} incidents={overlapping(incidents, bin)} />
          </HoverCard>
        ))}
      </div>
      <div className="flex justify-between text-caption text-muted-foreground">
        <span>{stats.hours <= 24 ? "24 hours ago" : stats.hours <= 168 ? "7 days ago" : "30 days ago"}</span>
        <span>Now</span>
      </div>
    </div>
  );
}

function BinDetails({ bin, incidents }: { bin: Bin; incidents: Incident[] }) {
  const failed = bin.checks - bin.ok;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{range(bin)}</span>
        {bin.checks ? (
          <span className={cn("font-medium tabular-nums", failed ? "text-down" : "text-up")}>{percent(bin.ok / bin.checks)}</span>
        ) : null}
      </div>
      {bin.checks === 0 ? (
        <p className="text-muted-foreground">No checks ran in this period.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums">
          <dt className="text-muted-foreground">Checks</dt>
          <dd className="text-right">{failed ? `${failed} of ${bin.checks} failed` : `${bin.checks}, all passed`}</dd>
          {bin.latencyChecks ? (
            <>
              <dt className="text-muted-foreground">Average</dt>
              <dd className="text-right">{Math.round(bin.latencySum / bin.latencyChecks)} ms</dd>
              {bin.min !== null && bin.max !== null && bin.min !== bin.max ? (
                <>
                  <dt className="text-muted-foreground">Fastest · slowest</dt>
                  <dd className="text-right">
                    {bin.min} · {bin.max} ms
                  </dd>
                </>
              ) : null}
            </>
          ) : null}
        </dl>
      )}
      {incidents.length ? (
        <ul className="flex flex-col gap-1.5 border-t border-border pt-2.5">
          {incidents.map((i) => (
            <li key={i.id} className="flex flex-col">
              <span className="font-medium text-down">{i.cause}</span>
              <span className="text-muted-foreground">
                {time(new Date(i.startedAt).getTime())} · {i.resolvedAt ? `down for ${duration(i.startedAt, i.resolvedAt)}` : "still down"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function colorOf(bin: Bin): string {
  if (bin.checks === 0) return "bg-subtle";
  if (bin.ok === bin.checks) return "bg-up";
  if (bin.ok === 0) return "bg-down";
  return "bg-pending";
}

function range(bin: Bin): string {
  const from = new Date(bin.from);
  const sameDay = new Date(bin.to - 1).toDateString() === from.toDateString();
  const day = from.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (bin.to - bin.from >= 24 * HOUR) return day;
  return sameDay
    ? `${day}, ${time(bin.from)} – ${time(bin.to)}`
    : `${day}, ${time(bin.from)} – ${new Date(bin.to).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...hourOptions() })}`;
}

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...hourOptions() });
}

function overlapping(incidents: Incident[], bin: Bin): Incident[] {
  return incidents.filter((i) => {
    const start = new Date(i.startedAt).getTime();
    const end = i.resolvedAt ? new Date(i.resolvedAt).getTime() : Date.now();
    return start < bin.to && end >= bin.from;
  });
}

function toBins(stats: MonitorStats, binHours: number): Bin[] {
  const now = Math.floor(Date.now() / HOUR) * HOUR;
  const count = Math.ceil(stats.hours / binHours);
  const size = binHours * HOUR;
  const start = now - (count * binHours - 1) * HOUR;
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    from: start + i * size,
    to: start + (i + 1) * size,
    checks: 0,
    ok: 0,
    latencySum: 0,
    latencyChecks: 0,
    min: null,
    max: null,
  }));
  for (const point of stats.series) {
    const bin = bins[Math.floor((new Date(point.hour).getTime() - start) / size)];
    if (!bin) continue;
    bin.checks += point.checks;
    bin.ok += point.ok;
    if (point.avgLatencyMs !== null) {
      // Hourly averages folded into the bin, weighted by how many checks each hour had.
      bin.latencySum += point.avgLatencyMs * point.checks;
      bin.latencyChecks += point.checks;
    }
    if (point.minLatencyMs !== null) bin.min = bin.min === null ? point.minLatencyMs : Math.min(bin.min, point.minLatencyMs);
    if (point.maxLatencyMs !== null) bin.max = bin.max === null ? point.maxLatencyMs : Math.max(bin.max, point.maxLatencyMs);
  }
  return bins;
}
