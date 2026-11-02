import { Result } from "better-result";
import { DeliveryFailed } from "@tiny-uptime/core";
import { USER_AGENT } from "../checks/http";
import { errorText } from "../checks/timeout";

/** A slow or hung receiver must not hold the alarm that sends alerts. */
const SEND_TIMEOUT_MS = 10_000;

type Options = { headers?: Record<string, string>; redirect?: "follow" | "manual" };

/**
 * POSTs JSON and hands back the response. Errors name the host only: a webhook path, bot token or topic in the URL is
 * a credential, and the message is stored with a failed delivery and shown in the panel.
 */
export async function postJson(url: string, body: unknown, options: Options = {}): Promise<Result<Response, DeliveryFailed>> {
  const host = new URL(url).host;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT, ...options.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      ...(options.redirect ? { redirect: options.redirect } : {}),
    });
    return Result.ok(res);
  } catch (error) {
    return Result.err(new DeliveryFailed({ message: `${host}: ${errorText(error).replaceAll(url, host)}` }));
  }
}

/** POSTs JSON where only the status matters: any 2xx is delivered. */
export async function deliverJson(url: string, body: unknown, options: Options = {}): Promise<Result<void, DeliveryFailed>> {
  const sent = await postJson(url, body, options);
  if (sent.isErr()) return Result.err(sent.error);
  const res = sent.value;
  // the body is not needed; cancelling frees the connection instead of waiting for it
  await res.body?.cancel();
  return res.ok ? Result.ok(undefined) : Result.err(rejected(url, res.status));
}

export function rejected(url: string, status: number, why = ""): DeliveryFailed {
  return new DeliveryFailed({ message: `${new URL(url).host} responded HTTP ${status}${why}` });
}
