import { Result } from "better-result";
import type { MaintenanceInput } from "@tiny-uptime/contracts";
import type { MaintenanceWindow } from "../../domain/maintenance";
import { Invalid, NotFound } from "../../errors";
import type { WorkspaceDeps } from "./deps";

export function listMaintenance(d: WorkspaceDeps): MaintenanceWindow[] {
  return d.maintenance.list();
}

export function createMaintenance(d: WorkspaceDeps, input: MaintenanceInput): Result<MaintenanceWindow, Invalid> {
  return toWindow(d, d.ids.id(), input, d.clock.now()).map((window) => {
    d.maintenance.insert(window);
    return window;
  });
}

export function updateMaintenance(d: WorkspaceDeps, id: string, input: MaintenanceInput): Result<MaintenanceWindow, NotFound | Invalid> {
  const current = d.maintenance.get(id);
  if (!current) return Result.err(new NotFound({ message: "maintenance window not found" }));
  return toWindow(d, id, input, current.createdAt).map((window) => {
    d.maintenance.save(window);
    return window;
  });
}

export function deleteMaintenance(d: WorkspaceDeps, id: string): Result<void, NotFound> {
  if (!d.maintenance.get(id)) return Result.err(new NotFound({ message: "maintenance window not found" }));
  d.maintenance.delete(id);
  return Result.ok(undefined);
}

function toWindow(d: WorkspaceDeps, id: string, input: MaintenanceInput, createdAt: number): Result<MaintenanceWindow, Invalid> {
  const unknown = input.monitorIds.find((monitorId) => !d.monitors.get(monitorId));
  if (unknown) return Result.err(new Invalid({ field: "monitorIds", message: `monitorIds: no monitor ${unknown} in this workspace` }));
  const { recurrence } = input;
  return Result.ok({
    id,
    name: input.name,
    monitorIds: input.monitorIds,
    startsAt: new Date(input.startsAt).getTime(),
    endsAt: new Date(input.endsAt).getTime(),
    recurrence: recurrence
      ? {
          frequency: recurrence.frequency,
          days: recurrence.frequency === "weekly" ? [...new Set(recurrence.days)].toSorted() : [],
          timezone: recurrence.timezone,
          until: recurrence.until ? new Date(recurrence.until).getTime() : null,
        }
      : null,
    createdAt,
  });
}
