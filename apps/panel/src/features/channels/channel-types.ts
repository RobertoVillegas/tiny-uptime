import type { ChannelType } from "@tiny-uptime/contracts";

/** Names people know each channel by, in the order the type picker lists them. */
export const CHANNEL_TYPE_OPTIONS: { value: ChannelType; label: string }[] = [
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "telegram", label: "Telegram" },
  { value: "ntfy", label: "ntfy" },
  { value: "email", label: "Email" },
  { value: "pagerduty", label: "PagerDuty" },
  { value: "lark", label: "Lark / Feishu" },
  { value: "webhook", label: "Webhook (JSON)" },
];

export const CHANNEL_TYPE_LABEL = Object.fromEntries(CHANNEL_TYPE_OPTIONS.map((o) => [o.value, o.label])) as Record<ChannelType, string>;

export type SettingField = "url" | "topic" | "token" | "priority" | "secret" | "botToken" | "chatId" | "routingKey" | "to";

type FieldSpec = {
  name: Exclude<SettingField, "priority">;
  label: string;
  description?: string;
  placeholder?: string;
  kind?: "url" | "email" | "secret";
};

/** The settings each type asks for, with where to find them; ntfy's priority is a select, added by the form. */
export const CHANNEL_FIELDS: Record<ChannelType, FieldSpec[]> = {
  webhook: [
    {
      name: "url",
      label: "Webhook URL",
      kind: "url",
      description: "Receives a JSON POST in OpenUptime's format. Only its host is shown afterwards: the path often carries a secret.",
    },
  ],
  slack: [
    {
      name: "url",
      label: "Incoming webhook URL",
      kind: "url",
      placeholder: "https://hooks.slack.com/services/…",
      description: "Create one under Incoming Webhooks in your Slack app.",
    },
  ],
  discord: [
    {
      name: "url",
      label: "Channel webhook URL",
      kind: "url",
      placeholder: "https://discord.com/api/webhooks/…",
      description: "In the channel's settings, under Integrations. Alerts never mention anyone.",
    },
  ],
  teams: [
    {
      name: "url",
      label: "Workflow webhook URL",
      kind: "url",
      placeholder: "https://…/workflows/…",
      description: "From a Workflow started by “When a Teams webhook request is received”, triggerable by anyone.",
    },
  ],
  ntfy: [
    { name: "url", label: "Server", kind: "url", placeholder: "https://ntfy.sh", description: "The server's address, without the topic." },
    {
      name: "topic",
      label: "Topic",
      placeholder: "my-alerts-7f3k",
      description: "Up to 64 letters, digits, - or _. Anyone who knows a topic on a public server can read it, so pick one hard to guess.",
    },
    { name: "token", label: "Access token (optional)", kind: "secret", description: "Sent as a bearer token; needs an https server." },
  ],
  lark: [
    {
      name: "url",
      label: "Custom bot webhook URL",
      kind: "url",
      placeholder: "https://open.larksuite.com/open-apis/bot/v2/hook/…",
      description: "On open.larksuite.com or open.feishu.cn.",
    },
    { name: "secret", label: "Signing secret (optional)", kind: "secret", description: "Set it if the bot has signature verification on." },
  ],
  telegram: [
    {
      name: "botToken",
      label: "Bot token",
      kind: "secret",
      placeholder: "123456789:AAE…",
      description: "From @BotFather. It is never shown again.",
    },
    {
      name: "chatId",
      label: "Chat ID",
      placeholder: "-1001234567890",
      description: "A numeric chat ID, or @channelusername for a public channel. Add the bot to the chat first.",
    },
  ],
  pagerduty: [
    {
      name: "routingKey",
      label: "Integration key",
      kind: "secret",
      description: "From an Events API v2 integration. Outages trigger an incident and recoveries resolve it.",
    },
  ],
  email: [{ name: "to", label: "Send to", kind: "email", placeholder: "oncall@example.com" }],
};
