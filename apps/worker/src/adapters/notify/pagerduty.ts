import type { Result } from "better-result";
import { formatAlert, type AlertEvent, type ChannelOf, type DeliveryFailed } from "@tiny-uptime/core";
import { deliverJson } from "./send";
import { clip } from "./text";

const EVENTS_URL = "https://events.pagerduty.com/v2/enqueue";

/**
 * PagerDuty Events API v2. The incident id is the dedup key, so the open alert triggers a PagerDuty incident,
 * reminders and escalations fold into that same one, and the recovery resolves it. A test sends a resolve for a
 * key that never triggered: PagerDuty checks the routing key and accepts it, and nobody gets paged.
 */
export function sendPagerDuty(channel: ChannelOf<"pagerduty">, event: AlertEvent): Promise<Result<void, DeliveryFailed>> {
  const message = formatAlert(event);
  return deliverJson(EVENTS_URL, {
    routing_key: channel.routingKey,
    event_action: event.kind === "resolved" || event.test ? "resolve" : "trigger",
    dedup_key: event.incident.id,
    payload: {
      // PagerDuty truncates a summary over 1024 characters
      summary: clip(message.text, 1024),
      source: event.monitor.target || event.monitor.name,
      severity: event.slow ? "warning" : "critical",
    },
  });
}
