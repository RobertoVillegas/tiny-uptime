import type { ChannelType } from "@tiny-uptime/contracts";

export type Channel = { id: string; type: ChannelType; name: string; url: string; enabled: boolean; createdAt: number };

/** An alert that failed to reach its channel, waiting to be retried. */
export type Delivery = { id: string; channelId: string; payload: string; attempts: number; nextAt: number; lastError: string | null };

/** Delays before each retry of a failed delivery; it is dropped after the last one. */
export const DELIVERY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

export function nextRetryAt(attempts: number, now: number): number | null {
  const delay = DELIVERY_BACKOFF_MS[attempts - 1];
  return delay === undefined ? null : now + delay;
}
