import * as v from "valibot";

export const CHANNEL_TYPES = ["webhook"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

const webhookUrl = v.pipe(
  v.string(),
  v.trim(),
  v.url(),
  v.check((value) => /^https?:\/\//i.test(value), "must be an http or https URL"),
);

export const ChannelInput = v.object({
  type: v.picklist(CHANNEL_TYPES),
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
  url: webhookUrl,
  enabled: v.optional(v.boolean(), true),
});
export type ChannelInput = v.InferOutput<typeof ChannelInput>;
export type ChannelDraft = v.InferInput<typeof ChannelInput>;

export const ChannelPatch = v.object({
  type: v.optional(v.picklist(CHANNEL_TYPES)),
  name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100))),
  url: v.optional(webhookUrl),
  enabled: v.optional(v.boolean()),
});
export type ChannelPatch = v.InferOutput<typeof ChannelPatch>;

/** Webhook URLs carry their secret in the path, so a channel only ever shows its host. */
export type Channel = { id: string; type: ChannelType; name: string; enabled: boolean; host: string; createdAt: string };
