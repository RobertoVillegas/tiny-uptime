import type { CheckOutcome, HttpTarget } from "@tiny-uptime/core";
import { errorText } from "./timeout";

export const USER_AGENT = "tiny-uptime/0.1 (+https://github.com/RobertoVillegas/tiny-uptime)";
/** Keyword checks read at most this much of the body. */
const MAX_KEYWORD_BYTES = 256 * 1024;

export async function checkHttp(target: HttpTarget): Promise<CheckOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  try {
    const res = await fetch(target.url, {
      method: target.method,
      headers: { "user-agent": USER_AGENT, ...target.headers },
      ...(target.body !== undefined ? { body: target.body } : {}),
      signal: AbortSignal.timeout(target.timeoutMs),
    });
    const statusOk = target.expectedStatus.length ? target.expectedStatus.includes(res.status) : res.status < 400;
    if (!statusOk || !target.keyword) {
      await res.body?.cancel();
      return { ok: statusOk, latencyMs: elapsed(), detail: `HTTP ${res.status}` };
    }
    const found = (await readText(res, MAX_KEYWORD_BYTES)).includes(target.keyword.value);
    const ok = target.keyword.mode === "contains" ? found : !found;
    return { ok, latencyMs: elapsed(), detail: ok ? `HTTP ${res.status}` : `HTTP ${res.status}, keyword ${found ? "present" : "missing"}` };
  } catch (error) {
    return { ok: false, latencyMs: elapsed(), detail: errorText(error) };
  }
}

async function readText(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (bytes < limit) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return text;
}
