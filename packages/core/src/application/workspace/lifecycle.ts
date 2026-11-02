import { retryDeliveries } from "./alerts";
import { runDueChecks } from "./checks";
import type { WorkspaceDeps } from "./deps";
import { cleanup } from "./maintenance";

/** A workspace's database is created by the operator; until then it answers nothing, so guessed ids cost no storage. */
export function initWorkspace(d: WorkspaceDeps, id: string, name: string): void {
  if (!d.info.get()) d.info.init(id, name, d.clock.now());
}

/** Everything the alarm does when it wakes: due checks, alert retries, daily cleanup, next wake-up. */
export async function onAlarm(d: WorkspaceDeps): Promise<void> {
  if (!d.info.get()) return;
  await runDueChecks(d);
  await retryDeliveries(d);
  cleanup(d);
  await d.scheduler.sync();
}
