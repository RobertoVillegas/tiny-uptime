import type { AlertEvent } from "../../domain/incident";
import { nextRetryAt } from "../../domain/channel";
import type { WorkspaceDeps } from "./deps";

/** Sends to every enabled channel now; a failed delivery is queued and retried from the alarm. */
export async function dispatchAlert(d: WorkspaceDeps, event: AlertEvent): Promise<void> {
  await Promise.all(
    d.channels.enabled().map(async (channel) => {
      const sent = await d.notifier.send(channel, event);
      if (sent.isOk()) return;
      const now = d.clock.now();
      d.deliveries.enqueue({
        id: d.ids.id(),
        channelId: channel.id,
        payload: JSON.stringify(event),
        attempts: 1,
        nextAt: nextRetryAt(1, now)!,
        lastError: sent.error.message,
      });
    }),
  );
}

export async function retryDeliveries(d: WorkspaceDeps): Promise<void> {
  const now = d.clock.now();
  for (const delivery of d.deliveries.due(now)) {
    const channel = d.channels.get(delivery.channelId);
    if (!channel?.enabled) {
      d.deliveries.remove(delivery.id);
      continue;
    }
    const sent = await d.notifier.send(channel, JSON.parse(delivery.payload) as AlertEvent);
    if (sent.isOk()) {
      d.deliveries.remove(delivery.id);
      continue;
    }
    const attempts = delivery.attempts + 1;
    const retryAt = nextRetryAt(attempts, now);
    if (retryAt === null) {
      console.error("alert delivery dropped after retries", delivery.channelId, sent.error.message);
      d.deliveries.remove(delivery.id);
    } else {
      d.deliveries.reschedule(delivery.id, attempts, retryAt, sent.error.message);
    }
  }
}
