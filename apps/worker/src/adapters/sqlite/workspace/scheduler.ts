import type { Scheduler } from "@tiny-uptime/core";
import { first } from "../rows";

const MINUTE = 60_000;

/**
 * Keeps the Durable Object's single alarm on the earliest pending check or alert retry. While
 * reminders or escalation could be due for an open incident, it also wakes at least once a minute.
 */
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
    const followUp = this.followUpWake();
    const wake = next == null ? followUp : followUp === null ? next : Math.min(next, followUp);
    const current = await this.storage.getAlarm();
    if (wake == null) {
      if (current !== null) await this.storage.deleteAlarm();
    } else if (current !== wake) {
      await this.storage.setAlarm(wake);
    }
  }

  private followUpWake(): number | null {
    const policy = first(this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'alert_policy'"))?.value;
    if (!policy) return null;
    const { reminderEveryMinutes = 0, escalateAfterMinutes = 0 } = JSON.parse(policy) as {
      reminderEveryMinutes?: number;
      escalateAfterMinutes?: number;
    };
    if (reminderEveryMinutes === 0 && escalateAfterMinutes === 0) return null;
    const waiting = first(
      this.sql.exec<{ n: number }>(
        "SELECT count(*) AS n FROM incident WHERE resolved_at IS NULL AND acknowledged_at IS NULL AND notified = 1",
      ),
    )!.n;
    return waiting > 0 ? Math.ceil((Date.now() + 1) / MINUTE) * MINUTE : null;
  }
}
