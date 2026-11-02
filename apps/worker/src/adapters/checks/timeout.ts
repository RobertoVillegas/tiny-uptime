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

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
