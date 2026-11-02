import { Result } from "better-result";
import type { Principal } from "../../domain/access";
import { Invalid, NotFound } from "../../errors";
import type { WorkspaceDeps } from "./deps";

/** Acknowledging says someone is on it: reminders and escalation stop for this incident. */
export function acknowledgeIncident(d: WorkspaceDeps, id: string, by: Principal): Result<void, NotFound | Invalid> {
  const incident = d.incidents.get(id);
  if (!incident) return Result.err(new NotFound({ message: "incident not found" }));
  if (incident.resolvedAt !== null) return Result.err(new Invalid({ field: "id", message: "this incident is already resolved" }));
  if (incident.acknowledgedAt === null) d.incidents.acknowledge(id, d.clock.now(), by.kind === "member" ? by.userId : "api-key");
  return Result.ok(undefined);
}
