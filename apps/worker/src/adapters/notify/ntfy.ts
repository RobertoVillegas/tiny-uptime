import type { Result } from "better-result";
import { formatAlert, type AlertEvent, type ChannelOf, type DeliveryFailed } from "@tiny-uptime/core";
import { deliverJson } from "./send";
import { clipBytes } from "./text";

/** ntfy turns a message over 4096 bytes into an attachment; staying below keeps it a plain notification. */
const NTFY_MAX_BYTES = 4000;

/**
 * Publishes as JSON to the server's root, with the topic in the body. Redirects are not followed: the server was
 * checked when the channel was saved, and a redirect would send the topic and token somewhere that was not.
 */
export function sendNtfy(channel: ChannelOf<"ntfy">, event: AlertEvent): Promise<Result<void, DeliveryFailed>> {
  const message = formatAlert(event);
  return deliverJson(
    new URL("/", channel.url).href,
    { topic: channel.topic, title: message.title, message: clipBytes(message.text, NTFY_MAX_BYTES), priority: channel.priority },
    { redirect: "manual", ...(channel.token ? { headers: { authorization: `Bearer ${channel.token}` } } : {}) },
  );
}
