import { Result } from "better-result";
import { afterCheck, afterHeartbeat, afterMissedHeartbeat, type CheckOutcome } from "../../domain/monitor/health";
import { Conflict, NotFound } from "../../errors";
import type { Monitor } from "../../domain/monitor/monitor";
import { applyHealthUpdate } from "./health";
import type { WorkspaceDeps } from "./deps";

/** Checks run side by side in batches, within Workers' limit of six open connections. */
const CONCURRENCY = 6;

export async function runDueChecks(d: WorkspaceDeps): Promise<void> {
  const now = d.clock.now();
  const due = d.monitors.due(now);
  const checks = due.filter((m) => m.type !== "heartbeat");
  for (let i = 0; i < checks.length; i += CONCURRENCY) {
    const batch = checks.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(batch.map((m) => d.checker.check(m)));
    for (const [index, before] of batch.entries()) {
      const monitor = stillCurrent(d, before);
      if (monitor) await applyHealthUpdate(d, monitor, afterCheck(monitor, outcomes[index]!, now), now);
    }
  }
  for (const before of due.filter((m) => m.type === "heartbeat")) {
    const monitor = stillCurrent(d, before);
    if (monitor && monitor.state.nextCheckAt !== null && monitor.state.nextCheckAt <= now) {
      await applyHealthUpdate(d, monitor, afterMissedHeartbeat(monitor, now), now);
    }
  }
}

/**
 * Other requests run while a check waits on the network: the monitor may have been paused, edited
 * or deleted meanwhile. Only a result for the monitor as it still is gets recorded.
 */
function stillCurrent(d: WorkspaceDeps, before: Monitor): Monitor | null {
  const monitor = d.monitors.get(before.id);
  return monitor && !monitor.paused && monitor.updatedAt === before.updatedAt ? monitor : null;
}

/**
 * Runs one check now, as when someone has just fixed something and wants to see it. It counts
 * like a scheduled one, so it can resolve an incident; on a paused monitor it only reports.
 */
export async function checkNow(
  d: WorkspaceDeps,
  id: string,
): Promise<Result<{ outcome: CheckOutcome; monitor: Monitor }, NotFound | Conflict>> {
  const before = d.monitors.get(id);
  if (!before) return Result.err(new NotFound({ message: "monitor not found" }));
  if (before.type === "heartbeat") return Result.err(new Conflict({ message: "a heartbeat is checked when its ping arrives" }));
  const outcome = await d.checker.check(before);
  const monitor = stillCurrent(d, before);
  if (monitor) {
    const now = d.clock.now();
    await applyHealthUpdate(d, monitor, afterCheck(monitor, outcome, now), now);
    await d.scheduler.sync();
  }
  return Result.ok({ outcome, monitor: d.monitors.get(id) ?? before });
}

/** Returns false for an unknown token, so the caller can answer 404. */
export async function recordHeartbeat(d: WorkspaceDeps, token: string): Promise<boolean> {
  if (!d.info.get()) return false;
  const monitor = d.monitors.byHeartbeatToken(token);
  if (!monitor) return false;
  if (monitor.paused) return true;
  const now = d.clock.now();
  await applyHealthUpdate(d, monitor, afterHeartbeat(monitor, now), now);
  await d.scheduler.sync();
  return true;
}
