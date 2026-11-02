import * as v from "valibot";

export const ApiKeyInput = v.object({ name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)) });
export type ApiKeyInput = v.InferOutput<typeof ApiKeyInput>;

export type ApiKey = { id: string; name: string; hint: string; createdAt: string; lastUsedAt: string | null };
/** Only the response that creates a key carries the key itself. */
export type CreatedApiKey = ApiKey & { key: string };
