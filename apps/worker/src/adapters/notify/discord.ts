import type { Result } from "better-result";
import { formatAlert, type AlertEvent, type ChannelOf, type DeliveryFailed } from "@tiny-uptime/core";
import { deliverJson } from "./send";
import { clip } from "./text";

/**
 * Discord channel webhook. `wait=true` makes Discord confirm the message was created, and `allowed_mentions` with no
 * types keeps an `@everyone` in a monitor name or cause from notifying the server. Discord caps content at 2000.
 */
export function sendDiscord(channel: ChannelOf<"discord">, event: AlertEvent): Promise<Result<void, DeliveryFailed>> {
  const endpoint = new URL(channel.url);
  endpoint.searchParams.set("wait", "true");
  // Angle brackets keep Discord from unfurling the panel's page under the alert.
  const link = event.link ? `\n[View incident](<${event.link}>)` : "";
  return deliverJson(endpoint.href, { content: clip(formatAlert(event).text, 2000 - link.length) + link, allowed_mentions: { parse: [] } });
}
