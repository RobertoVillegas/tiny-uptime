import { Result } from "better-result";
import type { ApiKey } from "../../domain/api-key";
import { NotFound } from "../../errors";
import type { WorkspaceDeps } from "./deps";

export function listApiKeys(d: WorkspaceDeps): ApiKey[] {
  return d.apiKeys.list();
}

/** Keys name their workspace (`tu_<workspace>_<secret>`) so requests reach it without a lookup; only the hash is stored. */
export async function createApiKey(d: WorkspaceDeps, name: string): Promise<{ apiKey: ApiKey; key: string }> {
  const key = `tu_${d.info.get()!.id}_${d.ids.secret(24)}`;
  const apiKey: ApiKey = {
    id: d.ids.id(),
    name,
    hash: await d.ids.hash(key),
    hint: `…${key.slice(-4)}`,
    createdAt: d.clock.now(),
    lastUsedAt: null,
  };
  d.apiKeys.insert(apiKey);
  return { apiKey, key };
}

export function deleteApiKey(d: WorkspaceDeps, id: string): Result<void, NotFound> {
  return d.apiKeys.delete(id) ? Result.ok(undefined) : Result.err(new NotFound({ message: "API key not found" }));
}
