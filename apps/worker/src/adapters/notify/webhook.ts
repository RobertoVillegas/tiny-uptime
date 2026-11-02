import { Result } from "better-result";
import { DeliveryFailed, type AlertEvent, type Channel, type Notifier } from "@tiny-uptime/core";
import { USER_AGENT } from "../checks/http";
import { errorText } from "../checks/timeout";

/**
 * Posts alerts as JSON in OpenUptime's webhook format, so receivers written for it (kukuroo's
 * /hook/openuptime among them) keep working unchanged.
 */
export function toOpenUptimePayload(event: AlertEvent) {
  return {
    kind: event.kind === "opened" ? "incident.opened" : "incident.resolved",
    incident: {
      id: event.incident.id,
      title: event.incident.title,
      startedAt: iso(event.incident.startedAt),
      resolvedAt: iso(event.incident.resolvedAt),
    },
    monitor: event.monitor,
    ...(event.test ? { test: true } : {}),
  };
}

export const webhookNotifier: Notifier = {
  async send(channel: Channel, event: AlertEvent): Promise<Result<void, DeliveryFailed>> {
    const host = new URL(channel.url).host;
    try {
      const res = await fetch(channel.url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": USER_AGENT },
        body: JSON.stringify(toOpenUptimePayload(event)),
        signal: AbortSignal.timeout(10_000),
      });
      await res.body?.cancel();
      if (!res.ok) return Result.err(new DeliveryFailed({ message: `${host} responded HTTP ${res.status}` }));
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(new DeliveryFailed({ message: `${host}: ${errorText(error)}` }));
    }
  },
};

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
