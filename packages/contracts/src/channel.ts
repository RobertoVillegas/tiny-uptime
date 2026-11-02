import * as v from "valibot";
import { hostIsPrivate } from "./public-host";

export const CHANNEL_TYPES = ["webhook", "slack", "discord", "teams", "ntfy", "lark", "telegram", "pagerduty", "email"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

/** Lark and Feishu custom bots live only on these hosts; anything else is not a Lark hook. */
export const LARK_HOSTS = ["open.larksuite.com", "open.feishu.cn"] as const;
export const NTFY_PRIORITIES = [1, 2, 3, 4, 5] as const;

const name = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100));
const enabled = v.optional(v.boolean(), true);

/** A URL tiny-uptime will POST to: http(s) only, and never an internal address. */
const publicUrl = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(2000),
  v.url(),
  v.check((value) => /^https?:\/\//i.test(value), "must be an http or https URL"),
  v.check((value) => !hostIsPrivate(new URL(value).hostname), "must not point at a private or internal address"),
);

/** An optional credential: an empty string removes it. */
const optionalSecret = (max: number) =>
  v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.maxLength(max),
      // printable ASCII only: anything else cannot travel in a header or a signature key
      v.regex(/^[\x20-\x7E]*$/, "must use printable ASCII characters only"),
      v.transform((value) => value || undefined),
    ),
  );

const UrlChannel = <T extends "webhook" | "slack" | "discord" | "teams">(type: T) =>
  v.object({ type: v.literal(type), name, enabled, url: publicUrl });

const NtfyChannel = v.pipe(
  v.object({
    type: v.literal("ntfy"),
    name,
    enabled,
    /** The server's origin, such as https://ntfy.sh; the topic goes in the message body. */
    url: v.pipe(
      publicUrl,
      v.check((value) => {
        const u = new URL(value);
        return u.pathname === "/" && !u.search && !u.hash && !u.username && !u.password;
      }, "must be the server's origin, without a topic, query or credentials"),
    ),
    topic: v.pipe(v.string(), v.trim(), v.regex(/^[A-Za-z0-9_-]{1,64}$/, "must be 1–64 letters, digits, underscores or hyphens")),
    token: optionalSecret(500),
    priority: v.optional(v.picklist(NTFY_PRIORITIES, "must be 1 to 5"), 3),
  }),
  v.forward(
    v.check((c) => !c.token || c.url.toLowerCase().startsWith("https://"), "is only sent to an https:// server"),
    ["token"],
  ),
);

const LarkChannel = v.object({
  type: v.literal("lark"),
  name,
  enabled,
  url: v.pipe(
    publicUrl,
    v.check(
      (value) => {
        const u = new URL(value);
        return u.protocol === "https:" && (LARK_HOSTS as readonly string[]).includes(u.hostname);
      },
      `must be a custom bot webhook on ${LARK_HOSTS.join(" or ")}`,
    ),
  ),
  /** Set when the bot has signature verification on. */
  secret: optionalSecret(200),
});

const TelegramChannel = v.object({
  type: v.literal("telegram"),
  name,
  enabled,
  /** Goes in the API path, so its shape is checked strictly. */
  botToken: v.pipe(
    v.string(),
    v.trim(),
    v.regex(/^\d{1,20}:[A-Za-z0-9_-]{20,100}$/, "must look like 123456789:AAE…, as BotFather gives it"),
  ),
  chatId: v.pipe(v.string(), v.trim(), v.regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/, "must be a numeric chat id or @channelusername")),
});

const PagerDutyChannel = v.object({
  type: v.literal("pagerduty"),
  name,
  enabled,
  /** The integration key of an Events API v2 integration. */
  routingKey: v.pipe(v.string(), v.trim(), v.regex(/^[A-Za-z0-9]{20,64}$/, "must be an Events API v2 integration key")),
});

const EmailChannel = v.object({
  type: v.literal("email"),
  name,
  enabled,
  to: v.pipe(v.string(), v.trim(), v.maxLength(254), v.email("must be an email address")),
});

/** A channel as clients send it: flat, with the fields of its type. */
export const ChannelInput = v.variant("type", [
  UrlChannel("webhook"),
  UrlChannel("slack"),
  UrlChannel("discord"),
  UrlChannel("teams"),
  NtfyChannel,
  LarkChannel,
  TelegramChannel,
  PagerDutyChannel,
  EmailChannel,
]);
export type ChannelInput = v.InferOutput<typeof ChannelInput>;
export type ChannelDraft = v.InferInput<typeof ChannelInput>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** What a channel of each type needs to deliver: its type and settings, secrets included. */
export type ChannelConfig = DistributiveOmit<ChannelInput, "name" | "enabled">;

/**
 * Fields to change on an existing channel; the rest keep their value, so a secret that is not sent again stays as
 * stored. The merged channel is checked against its type. The type cannot change.
 */
export const ChannelPatch = v.looseObject({ type: v.optional(v.picklist(CHANNEL_TYPES)) });
export type ChannelPatch = Partial<Record<string, unknown>> & { type?: ChannelType; name?: string; enabled?: boolean };

/**
 * A channel as the API shows it. Secrets never leave the server: `host` is where alerts go, and `target` names the
 * destination with its credentials masked (a webhook's path, an ntfy topic, a bot token or a routing key).
 */
export type Channel = { id: string; type: ChannelType; name: string; enabled: boolean; host: string; target: string; createdAt: string };
