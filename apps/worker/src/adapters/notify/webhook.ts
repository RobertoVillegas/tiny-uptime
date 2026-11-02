import type { Result } from "better-result";
import type { AlertEvent, ChannelOf, DeliveryFailed } from "@tiny-uptime/core";
import { deliverJson } from "./send";

/**
 * Posts alerts as JSON in OpenUptime's webhook format, so receivers written for it (kukuroo's
 * /hook/openuptime among them) keep working unchanged.
 */
export function toOpenUptimePayload(event: AlertEvent) {
  return {
    kind: `incident.${event.kind}`,
    ...(event.count !== undefined ? { count: event.count } : {}),
    ...(event.slow ? { slow: true } : {}),
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

export function sendWebhook(channel: ChannelOf<"webhook">, event: AlertEvent): Promise<Result<void, DeliveryFailed>> {
  return deliverJson(channel.url, toOpenUptimePayload(event));
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
