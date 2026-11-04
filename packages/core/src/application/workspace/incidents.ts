import { Result } from "better-result";
import type { DeclareIncident, ResolveIncident } from "@tiny-uptime/contracts";
import type { Incident } from "../../domain/incident";
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

/** Opens an incident by hand, with its first public update, for status page visitors. */
export function declareIncident(d: WorkspaceDeps, input: DeclareIncident, by: Principal): Result<Incident, Invalid> {
  const unknown = input.monitorIds.find((id) => !d.monitors.get(id));
  if (unknown) return Result.err(new Invalid({ field: "monitorIds", message: `no monitor ${unknown}` }));
  const now = d.clock.now();
  const incident: Incident = {
    id: d.ids.id(),
    monitorId: "",
    kind: input.kind,
    startedAt: now,
    resolvedAt: null,
    cause: input.title,
    acknowledgedAt: now,
    acknowledgedBy: author(by),
    notified: true,
    reminders: 0,
    lastReminderAt: null,
    escalatedAt: null,
    declared: true,
    affects: [...new Set(input.monitorIds)],
  };
  d.incidents.insert(incident);
  d.incidentUpdates.insert({
    id: d.ids.id(),
    incidentId: incident.id,
    status: "investigating",
    body: input.message,
    visibility: "public",
    author: author(by),
    createdAt: now,
  });
  return Result.ok(incident);
}

/** Closes a declared incident; ones a monitor opened resolve when it recovers. */
export function resolveIncident(d: WorkspaceDeps, id: string, input: ResolveIncident, by: Principal): Result<Incident, NotFound | Invalid> {
  const incident = d.incidents.get(id);
  if (!incident) return Result.err(new NotFound({ message: "incident not found" }));
  if (!incident.declared) return Result.err(new Invalid({ field: "id", message: "this incident resolves when its monitor recovers" }));
  if (incident.resolvedAt !== null) return Result.err(new Invalid({ field: "id", message: "this incident is already resolved" }));
  const now = d.clock.now();
  d.incidents.resolve(id, now);
  if (input.message) {
    d.incidentUpdates.insert({
      id: d.ids.id(),
      incidentId: id,
      status: "resolved",
      body: input.message,
      visibility: "public",
      author: author(by),
      createdAt: now,
    });
  }
  return Result.ok({ ...incident, resolvedAt: now });
}

function author(by: Principal): string {
  return by.kind === "member" ? by.userId : "api-key";
}
