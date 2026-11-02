import { MonitorInput, validate, type ImportRow } from "@tiny-uptime/contracts";
import { targetOf, toSettings } from "../../domain/monitor/monitor";
import type { WorkspaceDeps } from "./deps";
import { createMonitor, updateMonitor } from "./monitors";

/** One monitor to import, in the API's shape, with what an adapter had to change on the way in. */
export type ImportCandidate = { raw: Record<string, unknown>; notes?: string[] };

type Checked = { row: ImportRow; input: MonitorInput | null; sourceId: string | null; dependsOnSourceId: string | null };

/**
 * Creates monitors from another workspace or tool. Each one is validated on its own; one already here
 * (same type and target, or a heartbeat with the same name) is skipped as a duplicate, so importing
 * twice is harmless. Dependencies are re-linked to the new ids once everything exists.
 */
export async function importMonitors(d: WorkspaceDeps, candidates: ImportCandidate[], dryRun: boolean): Promise<ImportRow[]> {
  const known = new Map(d.monitors.list().map((m) => [identity(m.type, targetOf(m), m.name), m.id]));
  const checked = candidates.map((c) => check(c, known));
  if (dryRun) return checked.map((c) => c.row);

  const idBySource = new Map<string, string>();
  for (const c of checked) {
    if (c.input) {
      const created = await createMonitor(d, c.input);
      if (created.isErr()) Object.assign(c.row, { status: "invalid", message: created.error.message });
      else Object.assign(c.row, { status: "created", monitorId: created.value.id });
    }
    if (c.sourceId && c.row.monitorId) idBySource.set(c.sourceId, c.row.monitorId);
  }
  for (const c of checked) {
    if (c.row.status !== "created" || !c.dependsOnSourceId) continue;
    const parent = idBySource.get(c.dependsOnSourceId);
    if (!parent) {
      c.row.notes.push("its dependency was not imported, so it alerts on its own");
      continue;
    }
    const linked = await updateMonitor(d, c.row.monitorId!, { dependsOn: parent });
    if (linked.isErr()) c.row.notes.push(`could not keep its dependency: ${linked.error.message}`);
  }
  return checked.map((c) => c.row);
}

function check(candidate: ImportCandidate, known: Map<string, string>): Checked {
  const { raw } = candidate;
  const sourceId = typeof raw.id === "string" ? raw.id : null;
  const dependsOnSourceId = typeof raw.dependsOn === "string" ? raw.dependsOn : null;
  const name = typeof raw.name === "string" ? raw.name : "(no name)";
  const type = typeof raw.type === "string" ? raw.type : "unknown";
  const row: ImportRow = { name, type, status: "ready", monitorId: null, message: null, notes: [...(candidate.notes ?? [])] };
  const parsed = validate(MonitorInput, { ...raw, dependsOn: null, channelIds: [] });
  if (!parsed.ok) return { row: { ...row, status: "invalid", message: parsed.message }, input: null, sourceId, dependsOnSourceId };

  const settings = toSettings(parsed.value);
  const key = identity(settings.type, targetOf(settings), settings.name);
  const existing = known.get(key);
  if (existing !== undefined) {
    const message = existing ? "already monitored here" : "listed twice in this import";
    return { row: { ...row, status: "duplicate", monitorId: existing || null, message }, input: null, sourceId, dependsOnSourceId };
  }
  known.set(key, "");
  return { row, input: parsed.value, sourceId, dependsOnSourceId };
}

/** What makes two monitors the same: their target, or for heartbeats (which have none) their name. */
function identity(type: string, target: string, name: string): string {
  return type === "heartbeat" ? `heartbeat:${name.toLowerCase()}` : `${type}:${target.toLowerCase()}`;
}
