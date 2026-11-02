export type RpcReply = { result: unknown } | { error: { code: number; message: string } };

/** The reply to request `id`, or undefined when `raw` is something else (a notification, another id). */
export function rpcReply(raw: unknown, id: number): RpcReply | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const message = raw as Record<string, unknown>;
  if (message.jsonrpc !== "2.0" || message.id !== id) return undefined;
  if ("error" in message) {
    const error = message.error as { code?: unknown; message?: unknown } | null;
    return {
      error: {
        code: typeof error?.code === "number" ? error.code : 0,
        message: typeof error?.message === "string" ? error.message.slice(0, 200) : "unknown error",
      },
    };
  }
  return "result" in message ? { result: message.result } : undefined;
}

/**
 * The data of each complete event in a server-sent event stream read so far. An event ends at a blank
 * line, so a trailing event still arriving is left for the next call.
 */
export function sseData(text: string): string[] {
  const events = text.split(/\r\n\r\n|\n\n|\r\r/);
  events.pop();
  return events.flatMap((event) => {
    const data = event
      .split(/\r\n|\n|\r/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    return data.length ? [data.join("\n")] : [];
  });
}
