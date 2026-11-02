import type { ChannelConfig, ChannelInput, ChannelType } from "@tiny-uptime/contracts";

/** A channel and its typed settings, secrets included; `type` tells which settings it carries. */
export type Channel = { id: string; name: string; enabled: boolean; createdAt: number } & ChannelConfig;
export type ChannelOf<T extends ChannelType> = Extract<Channel, { type: T }>;

/** An alert that failed to reach its channel, waiting to be retried. */
export type Delivery = { id: string; channelId: string; payload: string; attempts: number; nextAt: number; lastError: string | null };

/** Delays before each retry of a failed delivery; it is dropped after the last one. */
export const DELIVERY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

export function nextRetryAt(attempts: number, now: number): number | null {
  const delay = DELIVERY_BACKOFF_MS[attempts - 1];
  return delay === undefined ? null : now + delay;
}

/** The channel as a client would send it, secrets included; the starting point for a patch. */
export function channelToInput(channel: Channel): ChannelInput {
  const { id: _id, createdAt: _createdAt, ...input } = channel;
  return input as ChannelInput;
}

/** Only the settings, as stored next to the channel's type. */
export function channelSettings(channel: Channel): Record<string, unknown> {
  const { id: _id, createdAt: _createdAt, type: _type, name: _name, enabled: _enabled, ...settings } = channel;
  return settings;
}

const MASK = "••••••••";

/**
 * Where a channel sends, safe to show: the host alerts go to, and the destination with every credential masked.
 * A webhook URL carries its secret in the path, an ntfy topic is readable by anyone who knows it, and bot tokens,
 * routing keys and signing secrets are passwords; none of them is ever shown.
 */
export function channelTarget(channel: Channel): { host: string; target: string } {
  switch (channel.type) {
    case "webhook":
    case "slack":
    case "discord":
    case "teams":
    case "lark": {
      const host = new URL(channel.url).host;
      return { host, target: host };
    }
    case "ntfy": {
      const host = new URL(channel.url).host;
      return { host, target: `${host}/${MASK}` };
    }
    case "telegram":
      return { host: "api.telegram.org", target: `chat ${channel.chatId}` };
    case "pagerduty":
      return { host: "events.pagerduty.com", target: `routing key ${MASK}${channel.routingKey.slice(-4)}` };
    case "email":
      return { host: channel.to.slice(channel.to.lastIndexOf("@") + 1), target: channel.to };
  }
}
