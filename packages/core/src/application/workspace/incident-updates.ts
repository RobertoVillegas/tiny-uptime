import { Result } from "better-result";
import type { IncidentUpdateInput } from "@tiny-uptime/contracts";
import type { Principal } from "../../domain/access";
import type { IncidentUpdate } from "../../domain/status-page";
import { NotFound } from "../../errors";
import type { WorkspaceDeps } from "./deps";

/** Notes people post on an incident; public ones reach status pages and feeds. */
export function postIncidentUpdate(
  d: WorkspaceDeps,
  incidentId: string,
  input: IncidentUpdateInput,
  by: Principal,
): Result<IncidentUpdate, NotFound> {
  if (!d.incidents.get(incidentId)) return Result.err(new NotFound({ message: "incident not found" }));
  const update: IncidentUpdate = {
    id: d.ids.id(),
    incidentId,
    status: input.status,
    body: input.body,
    visibility: input.visibility,
    author: by.kind === "member" ? by.userId : "api-key",
    createdAt: d.clock.now(),
  };
  d.incidentUpdates.insert(update);
  return Result.ok(update);
}

export function listIncidentUpdates(d: WorkspaceDeps, incidentId: string): Result<IncidentUpdate[], NotFound> {
  if (!d.incidents.get(incidentId)) return Result.err(new NotFound({ message: "incident not found" }));
  return Result.ok(d.incidentUpdates.forIncidents([incidentId], false));
}
