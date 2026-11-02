import type { WorkspaceDeps } from "./deps";

const DAY = 24 * 3_600_000;
/** History and resolved incidents are kept this long. */
export const RETENTION_MS = 400 * DAY;

/** Once a day, drops history older than the retention window. */
export function cleanup(d: WorkspaceDeps): void {
  const now = d.clock.now();
  if (now - d.info.lastCleanupAt() < DAY) return;
  const cutoff = now - RETENTION_MS;
  d.history.purgeBefore(cutoff);
  d.incidents.purgeResolvedBefore(cutoff);
  d.info.setLastCleanupAt(now);
}
