import { asObject, bool, httpUrl, InvalidInput, oneOf, str } from "./lib/validate";

export const CHANNEL_TYPES = ["webhook"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export type ChannelFields = { type: "webhook"; name: string; enabled: boolean; config: { url: string } };

export function parseChannel(body: unknown, current?: ChannelFields): ChannelFields {
  const input = { ...(current ? { type: current.type, name: current.name, enabled: current.enabled, ...current.config } : {}), ...asObject(body) };
  const type = oneOf(input, "type", CHANNEL_TYPES);
  if (current && type !== current.type) throw new InvalidInput("type", "cannot be changed");
  return { type, name: str(input, "name", { max: 100 }), enabled: bool(input, "enabled", true), config: { url: httpUrl(input, "url") } };
}

/** Webhook URLs carry their secret in the path; the API only ever shows the host. */
export function redactChannel(channel: ChannelFields): Record<string, unknown> {
  return { type: channel.type, name: channel.name, enabled: channel.enabled, host: new URL(channel.config.url).host };
}

/**
 * Same body as OpenUptime's webhook channel, so receivers written for it keep working
 * (kukuroo's /hook/openuptime among them).
 */
export type AlertPayload = {
  kind: "incident.opened" | "incident.resolved";
  incident: { id: string; title: string; startedAt: string; resolvedAt: string | null };
  monitor: { name: string; target: string };
  test?: true;
};

export async function deliver(channel: ChannelFields, payload: AlertPayload): Promise<void> {
  const res = await fetch(channel.config.url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "tiny-uptime/0.1" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`${new URL(channel.config.url).host} responded HTTP ${res.status}`);
}
