import { Result } from "better-result";
import { formatAlert, type AlertEvent, type ChannelOf, type DeliveryFailed } from "@tiny-uptime/core";
import { postJson, rejected } from "./send";

/**
 * Lark / Feishu custom bot. The hook answers 200 even when it refuses a message, so the body's `code` decides.
 * With signature verification on, Lark expects `sign = base64(HMAC-SHA256(key = "<timestamp>\n<secret>", message = ""))`
 * and a timestamp in seconds that is less than an hour old.
 */
export async function sendLark(channel: ChannelOf<"lark">, event: AlertEvent, now = Date.now()): Promise<Result<void, DeliveryFailed>> {
  const text = formatAlert(event).text;
  const body: Record<string, unknown> = { msg_type: "text", content: { text: event.link ? `${text}\n${event.link}` : text } };
  if (channel.secret) {
    const timestamp = String(Math.floor(now / 1000));
    body.timestamp = timestamp;
    body.sign = await larkSign(timestamp, channel.secret);
  }
  const sent = await postJson(channel.url, body);
  if (sent.isErr()) return Result.err(sent.error);
  const res = sent.value;
  const data = (await res.json().catch(() => null)) as { code?: number; msg?: string; StatusCode?: number; StatusMessage?: string } | null;
  const code = data?.code ?? data?.StatusCode ?? 0;
  if (res.ok && code === 0) return Result.ok(undefined);
  return Result.err(rejected(channel.url, res.status, code ? ` (${code}: ${data?.msg ?? data?.StatusMessage ?? "rejected"})` : ""));
}

export async function larkSign(timestamp: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${timestamp}\n${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new Uint8Array()));
  return btoa(String.fromCharCode(...mac));
}
