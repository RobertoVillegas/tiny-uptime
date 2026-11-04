import type { Result } from "better-result";
import { formatAlert, type AlertEvent, type ChannelOf, type DeliveryFailed } from "@tiny-uptime/core";
import { deliverJson } from "./send";

const RESERVED: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/**
 * Slack incoming webhook. `text` is mrkdwn, where `<…>` makes links and mentions such as `<!channel>`, so the three
 * characters Slack reserves are escaped and a monitor name cannot ping anyone.
 */
export function sendSlack(channel: ChannelOf<"slack">, event: AlertEvent): Promise<Result<void, DeliveryFailed>> {
  const text = formatAlert(event).text.replace(/[&<>]/g, (c) => RESERVED[c]!);
  return deliverJson(channel.url, { text: event.link ? `${text} · <${event.link}|View incident>` : text });
}
