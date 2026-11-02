import { Result } from "better-result";
import type { AlertPolicy } from "../../domain/incident";
import { Invalid } from "../../errors";
import type { WorkspaceDeps } from "./deps";

export function getAlertPolicy(d: WorkspaceDeps): AlertPolicy {
  return d.info.alertPolicy();
}

export async function setAlertPolicy(d: WorkspaceDeps, policy: AlertPolicy): Promise<Result<AlertPolicy, Invalid>> {
  const unknown = policy.escalationChannelIds.find((id) => !d.channels.get(id));
  if (unknown) return Result.err(new Invalid({ field: "escalationChannelIds", message: `escalationChannelIds: no channel ${unknown}` }));
  d.info.setAlertPolicy(policy);
  await d.scheduler.sync();
  return Result.ok(policy);
}
