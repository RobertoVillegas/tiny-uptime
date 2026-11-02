import { afterCheck, afterHeartbeat, afterMissedHeartbeat } from "../../domain/monitor/health";
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
