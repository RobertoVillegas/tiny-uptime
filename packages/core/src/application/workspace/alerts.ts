import type { Channel } from "../../domain/channel";
import { nextRetryAt } from "../../domain/channel";
import { alertFor, dueFollowUps, type AlertEvent } from "../../domain/incident";
import type { Monitor } from "../../domain/monitor/monitor";
import type { WorkspaceDeps } from "./deps";

/** The enabled channels a monitor alerts: the ones it names, or all of them when it names none. */
export function channelsFor(d: WorkspaceDeps, channelIds: string[]): Channel[] {
  const enabled = d.channels.enabled();
  return channelIds.length === 0 ? enabled : enabled.filter((c) => channelIds.includes(c.id));
}

/** Sends to each channel now; a failed delivery is queued and retried from the alarm. */
export async function dispatchAlert(d: WorkspaceDeps, event: AlertEvent, channels: Channel[]): Promise<void> {
  await Promise.all(
    channels.map(async (channel) => {
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

/**
 * Repeats alerts for incidents nobody acknowledged, and escalates outages that stay open too long,
 * following the workspace's alert policy.
 */
export async function sendFollowUps(d: WorkspaceDeps): Promise<void> {
  const policy = d.info.alertPolicy();
  if (policy.reminderEveryMinutes === 0 && policy.escalateAfterMinutes === 0) return;
  const now = d.clock.now();
  for (const incident of d.incidents.open()) {
    const due = dueFollowUps(incident, policy, now);
    if (!due.remind && !due.escalate) continue;
    const monitor = d.monitors.get(incident.monitorId);
    if (!monitor) continue;
    if (due.remind) {
      await dispatchAlert(d, alertFor("reminder", monitor, incident, now), channelsFor(d, monitor.options.channelIds));
      d.incidents.recordReminder(incident.id, now);
    }
    if (due.escalate) {
      await dispatchAlert(d, alertFor("escalated", monitor, incident, now), channelsFor(d, policy.escalationChannelIds));
      d.incidents.markEscalated(incident.id, now);
    }
  }
}

export function monitorChannels(d: WorkspaceDeps, monitor: Monitor): Channel[] {
  return channelsFor(d, monitor.options.channelIds);
}
