import { connect } from "cloudflare:sockets";
import type { CheckOutcome, SocketTarget } from "@tiny-uptime/core";
import { errorText, withTimeout } from "./timeout";

export async function checkTcp(target: SocketTarget): Promise<CheckOutcome> {
  const started = Date.now();
  const socket = connect({ hostname: target.host, port: target.port });
  try {
    await withTimeout(socket.opened, target.timeoutMs);
    return { ok: true, latencyMs: Date.now() - started, detail: "connected" };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, detail: errorText(error) };
  } finally {
    socket.close().catch(() => {});
  }
}
