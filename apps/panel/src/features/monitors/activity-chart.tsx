import type { MonitorStats } from "@tiny-uptime/contracts";
import { cn } from "cn";

const HOUR = 3_600_000;
const W = 120;
const H = 28;

type Slot = { checks: number; ok: number; latency: number | null };

/**
 * The last day of one monitor in a list row: response time as a line, and hours with failed checks
 * marked red behind it. Monitors without latency (heartbeats) show one tick per hour instead.
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className={cn("h-7 w-full", className)}>
      {slots.map((s, i) =>
        s.checks > s.ok ? <rect key={`f${i}`} x={i * step} y={0} width={step} height={H} className="fill-down/25" /> : null,
      )}
      {latencies.length ? <Line slots={slots} step={step} /> : <Ticks slots={slots} step={step} />}
    </svg>
  );
}

function Line({ slots, step }: { slots: Slot[]; step: number }) {
  const values = slots.flatMap((s) => (s.latency === null ? [] : [s.latency]));
  const top = Math.max(...values);
  const bottom = Math.min(...values);
  // Leave a little room so a flat line sits mid-height instead of on the edge.
  const span = Math.max(top - bottom, top * 0.2, 1);
  const y = (v: number) => H - 3 - ((v - bottom) / span) * (H - 6);
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
  const slots: Slot[] = Array.from({ length: hours }, () => ({ checks: 0, ok: 0, latency: null }));
  for (const p of series) {
    const slot = slots[Math.round((new Date(p.hour).getTime() - start) / HOUR)];
    if (!slot) continue;
    slot.checks = p.checks;
    slot.ok = p.ok;
    slot.latency = p.avgLatencyMs;
  }
  return slots;
}
