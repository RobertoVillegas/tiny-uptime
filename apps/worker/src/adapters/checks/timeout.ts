/** Rejects after `ms`, and clears its timer either way so it never keeps a Durable Object awake. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * A failed check's cause, in words people can act on. The runtime reports DNS and connection
 * failures as an opaque "internal error; reference = …", which says nothing to the reader.
 */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || /timed? ?out/i.test(message)) return message.startsWith("timeout after") ? message : "timed out";
  if (/^internal error/i.test(message)) return "could not connect (DNS lookup or connection failed)";
  if (/certificate|tls|ssl/i.test(message)) return `TLS error: ${message}`;
  if (/refused/i.test(message)) return "connection refused";
  return message;
}
