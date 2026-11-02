import type { CheckOutcome, WebSocketTarget } from "@tiny-uptime/core";
import { USER_AGENT } from "./http";
import { errorText, withTimeout } from "./timeout";

/**
 * Up when the server accepts the upgrade. With a message, the server must also send something back
 * after it, whatever it is. Everything, from connecting to the reply, shares the monitor's timeout.
 */
export async function checkWebSocket(target: WebSocketTarget): Promise<CheckOutcome> {
  const started = Date.now();
  // Held outside the timed part, so a check that times out mid-conversation still closes it.
  const open: { socket: WebSocket | null } = { socket: null };
  try {
    return await withTimeout(
      (async () => {
        const url = new URL(target.url);
        url.protocol = url.protocol === "wss:" ? "https:" : "http:";
        const res = await fetch(url, { headers: { "user-agent": USER_AGENT, ...target.headers, upgrade: "websocket" } });
        const socket = res.webSocket;
        open.socket = socket;
        if (res.status !== 101 || !socket) {
          await res.body?.cancel();
          return { ok: false, latencyMs: Date.now() - started, detail: `expected 101 Switching Protocols, got HTTP ${res.status}` };
        }
        socket.accept();
        if (target.message === undefined) return { ok: true, latencyMs: Date.now() - started, detail: "connected" };
        const reply = nextMessage(socket);
        socket.send(target.message);
        const bytes = await reply;
        return { ok: true, latencyMs: Date.now() - started, detail: `connected, ${bytes} byte reply` };
      })(),
      target.timeoutMs,
    );
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, detail: errorText(error) };
  } finally {
    try {
      open.socket?.close(1000, "check done");
    } catch {
      // Already closed by the server.
    }
  }
}

/** The size of the next message, or a rejection when the connection ends first. */
function nextMessage(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const data: unknown = event.data;
      resolve(
        typeof data === "string"
          ? new TextEncoder().encode(data).length
          : data instanceof Blob
            ? data.size
            : (data as ArrayBuffer).byteLength,
      );
    });
    socket.addEventListener("close", (event) => {
      reject(new Error(`connection closed before a reply (code ${event.code}${event.reason ? `: ${event.reason.slice(0, 200)}` : ""})`));
    });
    socket.addEventListener("error", () => reject(new Error("connection failed before a reply")));
  });
}
