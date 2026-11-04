import type { MonitorStats } from "@tiny-uptime/contracts";
import { cn } from "cn";
import { useState } from "react";

const HOUR = 3_600_000;
const W = 120;
const H = 28;

type Slot = { from: number; checks: number; ok: number; latency: number | null; min: number | null; max: number | null };

/**
 * The last day of one monitor in a list row: response time as a line, and hours with failed checks
 * marked red behind it. Monitors without latency (heartbeats) show one tick per hour instead.
 * Hovering shows that hour against the day's range. The row is a link, so nothing here is focusable;
 * the same numbers are on the monitor's page.
 */
export function ActivityChart({
  series,
  hours,
  className,
}: {
  series: MonitorStats["series"] | undefined;
  hours: number;
  className?: string;
}) {
  const slots = toSlots(series ?? [], hours);
  const latencies = slots.flatMap((s) => (s.latency === null ? [] : [s.latency]));
  const failed = slots.reduce((n, s) => n + s.checks - s.ok, 0);
  const step = W / hours;
  const label =
    (latencies.length
      ? `Response time over the last ${hours} hours, ${Math.min(...latencies)}–${Math.max(...latencies)} ms`
      : `Last ${hours} hours`) + (failed ? `, ${failed} failed checks` : "");

  const [hover, setHover] = useState<number | null>(null);
  const slot = hover === null ? null : slots[hover]!;
  const scale = latencies.length ? lineScale(latencies) : null;
  const at = (i: number) => ((i + 0.5) / hours) * 100;

  return (
    <div
      className={cn("relative", className)}
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        setHover(Math.min(hours - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * hours))));
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="block h-7 w-full">
        {slots.map((s, i) =>
          s.checks > s.ok ? <rect key={`f${i}`} x={i * step} y={0} width={step} height={H} className="fill-down/25" /> : null,
        )}
        {scale ? <Line slots={slots} step={step} y={scale} /> : <Ticks slots={slots} step={step} />}
      </svg>
      {hover !== null && slot ? (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-foreground/30" style={{ left: `${at(hover)}%` }} />
          {scale && slot.latency !== null ? (
            <span
              aria-hidden
              className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-surface"
              style={{ left: `${at(hover)}%`, top: `${(scale(slot.latency) / H) * 100}%` }}
            />
          ) : null}
          <div
            aria-hidden
            className="pointer-events-none absolute top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-control bg-surface-raised p-3 text-[0.8125rem] shadow-raised"
            style={{ left: `${at(hover)}%` }}
          >
            <SlotDetails slot={slot} day={latencies.length ? [Math.min(...latencies), Math.max(...latencies)] : null} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function SlotDetails({ slot, day }: { slot: Slot; day: [number, number] | null }) {
  const failed = slot.checks - slot.ok;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {clock(slot.from)} – {clock(slot.from + HOUR)}
        </span>
        {slot.latency !== null ? <span className="font-medium tabular-nums">{slot.latency} ms</span> : null}
      </div>
      {slot.checks === 0 ? (
        <p className="text-muted-foreground">No checks in this hour.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 whitespace-nowrap tabular-nums">
          {slot.min !== null && slot.max !== null && slot.min !== slot.max ? (
            <>
              <dt className="text-muted-foreground">Fastest · slowest</dt>
              <dd className="text-right">
                {slot.min} · {slot.max} ms
              </dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Checks</dt>
          <dd className={cn("text-right", failed ? "text-down" : "")}>
            {failed ? `${failed} of ${slot.checks} failed` : `${slot.checks}, all passed`}
          </dd>
        </dl>
      )}
      {day ? (
        <p className="border-t border-border pt-2 text-muted-foreground tabular-nums">
          Hourly averages, last 24 h: {day[0]}–{day[1]} ms
        </p>
      ) : null}
    </div>
  );
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Maps a latency to a y coordinate, leaving a little room so a flat line sits mid-height. */
function lineScale(values: number[]): (v: number) => number {
  const top = Math.max(...values);
  const bottom = Math.min(...values);
  const span = Math.max(top - bottom, top * 0.2, 1);
  return (v) => H - 3 - ((v - bottom) / span) * (H - 6);
}

function Line({ slots, step, y }: { slots: Slot[]; step: number; y: (v: number) => number }) {
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  slots.forEach((s, i) => {
    if (s.latency === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({ x: i * step + step / 2, y: y(s.latency) });
  });
  if (run.length) runs.push(run);
  return (
    <>
      {runs.map((points) => {
        const d = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("");
        const first = points[0]!;
        const last = points.at(-1)!;
        return (
          <g key={first.x}>
            <path d={`${d}L${last.x.toFixed(2)},${H}L${first.x.toFixed(2)},${H}Z`} className="fill-primary/10" />
            {points.length === 1 ? (
              <circle cx={first.x} cy={first.y} r={1.5} className="fill-primary" />
            ) : (
              <path
                d={d}
                fill="none"
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="stroke-primary"
              />
            )}
          </g>
        );
      })}
    </>
  );
}

function Ticks({ slots, step }: { slots: Slot[]; step: number }) {
  return (
    <>
      {slots.map((s, i) => (
        <rect
          key={i}
          x={i * step + step * 0.15}
          y={H / 2 - 5}
          width={step * 0.7}
          height={10}
          rx={1}
          className={s.checks === 0 ? "fill-subtle" : s.ok === s.checks ? "fill-up" : s.ok === 0 ? "fill-down" : "fill-pending"}
        />
      ))}
    </>
  );
}

function toSlots(series: MonitorStats["series"], hours: number): Slot[] {
  const start = Math.floor(Date.now() / HOUR) * HOUR - (hours - 1) * HOUR;
  const slots: Slot[] = Array.from({ length: hours }, (_, i) => ({
    from: start + i * HOUR,
    checks: 0,
    ok: 0,
    latency: null,
    min: null,
    max: null,
  }));
  for (const p of series) {
    const slot = slots[Math.round((new Date(p.hour).getTime() - start) / HOUR)];
    if (!slot) continue;
    slot.checks = p.checks;
    slot.ok = p.ok;
    slot.latency = p.avgLatencyMs;
    slot.min = p.minLatencyMs;
    slot.max = p.maxLatencyMs;
  }
  return slots;
}
