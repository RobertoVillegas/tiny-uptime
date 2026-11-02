import { Result } from "better-result";
import { deniedMessage, roleAllows, type Action, type Principal } from "../../domain/access";
import { API_KEY_TOUCH_MS } from "../../domain/api-key";
import { Forbidden, Unauthorized } from "../../errors";
import type { WorkspaceDeps } from "./deps";

/** API keys are checked against this workspace's keys; members were checked by the Worker and carry their role. */
export function authorize(d: WorkspaceDeps, principal: Principal, action: Action): Result<void, Unauthorized | Forbidden> {
  if (principal.kind === "member") {
    return roleAllows(principal.role, action) ? Result.ok(undefined) : Result.err(new Forbidden({ message: deniedMessage(action) }));
  }
  const key = d.info.get() ? d.apiKeys.byHash(principal.keyHash) : null;
  if (!key) return Result.err(new Unauthorized({ message: "invalid API key" }));
  const now = d.clock.now();
  if (key.lastUsedAt === null || now - key.lastUsedAt > API_KEY_TOUCH_MS) d.apiKeys.touch(key.id, now);
  return Result.ok(undefined);
}
