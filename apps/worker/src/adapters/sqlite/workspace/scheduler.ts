import type { Scheduler } from "@tiny-uptime/core";
import { first } from "../rows";

/** Keeps the Durable Object's single alarm on the earliest pending check or alert retry. */
export class AlarmScheduler implements Scheduler {
  constructor(
    private readonly sql: SqlStorage,
    private readonly storage: DurableObjectStorage,
  ) {}

  async sync(): Promise<void> {
    const next = first(
      this.sql.exec<{ at: number | null }>(
        "SELECT min(at) AS at FROM (SELECT min(next_at) AS at FROM monitor WHERE paused = 0 UNION ALL SELECT min(next_at) FROM delivery)",
      ),
    )?.at;
    const current = await this.storage.getAlarm();
    if (next == null) {
      if (current !== null) await this.storage.deleteAlarm();
    } else if (current !== next) {
      await this.storage.setAlarm(next);
    }
  }
}
