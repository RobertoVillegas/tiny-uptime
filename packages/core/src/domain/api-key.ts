export type ApiKey = { id: string; name: string; hash: string; hint: string; createdAt: number; lastUsedAt: number | null };

/** A key's last use is written at most this often, so reads do not cost writes. */
export const API_KEY_TOUCH_MS = 60 * 60_000;
