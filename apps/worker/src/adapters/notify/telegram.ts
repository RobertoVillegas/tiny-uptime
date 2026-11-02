import { Result } from "better-result";
import { formatAlert, type AlertEvent, type ChannelOf, type DeliveryFailed } from "@tiny-uptime/core";
import { postJson, rejected } from "./send";
import { clip } from "./text";

/**
 * Telegram Bot API sendMessage. There is no `parse_mode`, so the text goes out as plain text and nothing in a monitor
 * name is read as Markdown or HTML. Telegram caps a message at 4096 characters. The bot token is in the path, which is
 * why errors only ever name the host.
 */
export async function sendTelegram(channel: ChannelOf<"telegram">, event: AlertEvent): Promise<Result<void, DeliveryFailed>> {
  const url = `https://api.telegram.org/bot${channel.botToken}/sendMessage`;
  const sent = await postJson(url, {
    chat_id: channel.chatId,
    text: clip(formatAlert(event).text, 4096),
    link_preview_options: { is_disabled: true },
  });
  if (sent.isErr()) return Result.err(sent.error);
  const res = sent.value;
  if (res.ok) {
    await res.body?.cancel();
    return Result.ok(undefined);
  }
  // Telegram explains a refusal ("chat not found", "bot was blocked by the user"); that is what people need to fix it
  const data = (await res.json().catch(() => null)) as { description?: unknown } | null;
  const why = typeof data?.description === "string" ? ` (${clip(data.description, 200)})` : "";
  return Result.err(rejected(url, res.status, why));
}
