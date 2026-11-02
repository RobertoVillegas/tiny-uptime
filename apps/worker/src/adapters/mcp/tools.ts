import { IncidentUpdateInput, MaintenanceInput, MONITOR_TYPES, MonitorInput, MonitorPatch, validate } from "@tiny-uptime/contracts";
import type { Principal } from "@tiny-uptime/core";
import type { Wire } from "../../runtime/wire";
import type { workspaceStub } from "../http/principal";
import { presentChannel, presentIncident, presentMaintenance, presentMonitor } from "../http/presenters";

export type ToolContext = { workspace: ReturnType<typeof workspaceStub>; principal: Principal; origin: string };
export type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
type Args = Record<string, unknown>;

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: Args, ctx: ToolContext) => Promise<ToolResult>;
};

const id = { type: "string", description: "A tiny-uptime id, 12 lowercase letters and digits." };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const read = { readOnlyHint: true, openWorldHint: false } as const;
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/** Turns a use case result into a tool result: the value as text and structured data, or the error as text. */
async function answer<T>(wire: Promise<Wire<T>> | Wire<T>, present: (value: T) => unknown = (v) => v): Promise<ToolResult> {
  const settled = await wire;
  if (settled.status === "error") {
    return { content: [{ type: "text", text: settled.error.message }], isError: true };
  }
  const value = present(settled.value);
  const structured = Array.isArray(value) ? { items: value } : ((value ?? { ok: true }) as Record<string, unknown>);
  return { content: [{ type: "text", text: JSON.stringify(value ?? { ok: true }, null, 2) }], structuredContent: structured };
}

function invalid(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function str(args: Args, key: string): string {
  return typeof args[key] === "string" ? (args[key] as string) : "";
}

export const TOOLS: readonly Tool[] = [
  {
    name: "get_workspace",
    title: "Workspace",
    description: "The workspace this key or account acts on: its id and name.",
    inputSchema: object({}),
    annotations: read,
    run: (_args, c) => answer(c.workspace.info(c.principal)),
  },
  {
    name: "list_monitors",
    title: "List monitors",
    description: "Every monitor with its status, last check, latency and settings. Optionally only those with a tag.",
    inputSchema: object({ tag: { type: "string", description: "Only monitors with this tag." } }),
    annotations: read,
    run: (args, c) =>
      answer(c.workspace.listMonitors(c.principal, args.tag ? { tag: str(args, "tag") } : {}), (list) =>
        list.map((m) => presentMonitor(m, c.origin)),
      ),
  },
  {
    name: "get_monitor",
    title: "Get a monitor",
    description: "One monitor by id, with its full settings and current state.",
    inputSchema: object({ id }, ["id"]),
    annotations: read,
    run: (args, c) => answer(c.workspace.getMonitor(c.principal, str(args, "id")), (m) => presentMonitor(m, c.origin)),
  },
  {
    name: "monitor_stats",
    title: "Monitor uptime and latency",
    description: "Uptime, average latency and an hourly series for a monitor over the last N hours (default 24, up to 2160).",
    inputSchema: object({ id, hours: { type: "integer", minimum: 1, maximum: 2160 } }, ["id"]),
    annotations: read,
    run: (args, c) => answer(c.workspace.monitorStats(c.principal, str(args, "id"), Number(args.hours ?? 24))),
  },
  {
    name: "create_monitor",
    title: "Create a monitor",
    description:
      "Creates a monitor. `monitor` takes the same flat fields as the REST API: type, name, intervalSec, and the type's target " +
      "(http: url, method, headers, expectedStatus, keyword; tcp/minecraft: host, port; heartbeat: graceSec), plus alert rules " +
      "(failureThreshold, recoveryThreshold, slowThresholdMs, tags, dependsOn, channelIds). Heartbeat monitors return the URL to ping.",
    inputSchema: object(
      {
        monitor: {
          type: "object",
          properties: { type: { enum: [...MONITOR_TYPES] }, name: { type: "string" } },
          required: ["type", "name"],
        },
      },
      ["monitor"],
    ),
    annotations: write,
    run: async (args, c) => {
      const parsed = validate(MonitorInput, args.monitor);
      if (!parsed.ok) return invalid(parsed.message);
      return answer(c.workspace.createMonitor(c.principal, parsed.value), (m) => presentMonitor(m, c.origin));
    },
  },
  {
    name: "update_monitor",
    title: "Change a monitor",
    description: "Changes some of a monitor's fields; the others keep their value. The type cannot change.",
    inputSchema: object({ id, changes: { type: "object" } }, ["id", "changes"]),
    annotations: { ...write, idempotentHint: true },
    run: async (args, c) => {
      const parsed = validate(MonitorPatch, args.changes);
      if (!parsed.ok) return invalid(parsed.message);
      return answer(c.workspace.updateMonitor(c.principal, str(args, "id"), parsed.value), (m) => presentMonitor(m, c.origin));
    },
  },
  {
    name: "pause_monitor",
    title: "Pause a monitor",
    description: "Stops checking a monitor and closes its open incident without alerting.",
    inputSchema: object({ id }, ["id"]),
    annotations: { ...write, idempotentHint: true },
    run: (args, c) => answer(c.workspace.updateMonitor(c.principal, str(args, "id"), { paused: true }), (m) => presentMonitor(m, c.origin)),
  },
  {
    name: "resume_monitor",
    title: "Resume a monitor",
    description: "Starts checking a paused monitor again.",
    inputSchema: object({ id }, ["id"]),
    annotations: { ...write, idempotentHint: true },
    run: (args, c) =>
      answer(c.workspace.updateMonitor(c.principal, str(args, "id"), { paused: false }), (m) => presentMonitor(m, c.origin)),
  },
  {
    name: "delete_monitor",
    title: "Delete a monitor",
    description: "Deletes a monitor with its history and incidents. This cannot be undone.",
    inputSchema: object({ id }, ["id"]),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (args, c) => answer(c.workspace.deleteMonitor(c.principal, str(args, "id")), () => ({ deleted: true })),
  },
  {
    name: "list_incidents",
    title: "List incidents",
    description: "Incidents newest first, open and resolved. Optionally for one monitor.",
    inputSchema: object({ monitorId: id, limit: { type: "integer", minimum: 1, maximum: 200 } }),
    annotations: read,
    run: (args, c) =>
      answer(
        c.workspace.listIncidents(c.principal, {
          ...(args.limit ? { limit: Number(args.limit) } : {}),
          ...(args.monitorId ? { monitorId: str(args, "monitorId") } : {}),
        }),
        (list) => list.map(presentIncident),
      ),
  },
  {
    name: "acknowledge_incident",
    title: "Acknowledge an incident",
    description: "Says someone is on it: reminders and escalation stop for this incident.",
    inputSchema: object({ id }, ["id"]),
    annotations: { ...write, idempotentHint: true },
    run: (args, c) => answer(c.workspace.acknowledgeIncident(c.principal, str(args, "id")), () => ({ acknowledged: true })),
  },
  {
    name: "post_incident_update",
    title: "Post an incident update",
    description:
      "Adds a note to an incident. Public notes (the default) appear on status pages and their RSS feed; internal ones only in the panel.",
    inputSchema: object(
      {
        id,
        body: { type: "string", maxLength: 2000 },
        status: { enum: ["investigating", "identified", "monitoring", "resolved", "update"] },
        visibility: { enum: ["public", "internal"] },
      },
      ["id", "body"],
    ),
    annotations: write,
    run: async (args, c) => {
      const { id: incidentId, ...rest } = args;
      const parsed = validate(IncidentUpdateInput, rest);
      if (!parsed.ok) return invalid(parsed.message);
      return answer(c.workspace.postIncidentUpdate(c.principal, String(incidentId ?? ""), parsed.value), (u) => ({
        ...u,
        createdAt: new Date(u.createdAt).toISOString(),
      }));
    },
  },
  {
    name: "list_channels",
    title: "List alert channels",
    description: "Where incidents are sent. Secrets in channel settings are never returned.",
    inputSchema: object({}),
    annotations: read,
    run: (_args, c) => answer(c.workspace.listChannels(c.principal), (list) => list.map(presentChannel)),
  },
  {
    name: "test_channel",
    title: "Send a test alert",
    description: "Sends a test alert to one channel and reports whether it was delivered.",
    inputSchema: object({ id }, ["id"]),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: (args, c) => answer(c.workspace.testChannel(c.principal, str(args, "id")), () => ({ delivered: true })),
  },
  {
    name: "list_maintenance",
    title: "List maintenance windows",
    description: "Maintenance windows, with whether each is active now or finished.",
    inputSchema: object({}),
    annotations: read,
    run: (_args, c) => answer(c.workspace.listMaintenance(c.principal), (list) => list.map((w) => presentMaintenance(w))),
  },
  {
    name: "create_maintenance",
    title: "Schedule maintenance",
    description:
      "Schedules a window when monitors keep checking but open no incidents. `window` has name, startsAt and endsAt (ISO 8601), " +
      "optional monitorIds (empty covers all), and optional recurrence { frequency: daily|weekly, days (0 is Sunday), timezone, until }.",
    inputSchema: object({ window: { type: "object" } }, ["window"]),
    annotations: write,
    run: async (args, c) => {
      const parsed = validate(MaintenanceInput, args.window);
      if (!parsed.ok) return invalid(parsed.message);
      return answer(c.workspace.createMaintenance(c.principal, parsed.value), (w) => presentMaintenance(w));
    },
  },
  {
    name: "delete_maintenance",
    title: "Delete a maintenance window",
    description: "Removes a maintenance window; covered monitors alert normally again.",
    inputSchema: object({ id }, ["id"]),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (args, c) => answer(c.workspace.deleteMaintenance(c.principal, str(args, "id")), () => ({ deleted: true })),
  },
  {
    name: "list_status_pages",
    title: "List status pages",
    description: "The workspace's public status pages, with the monitors each shows.",
    inputSchema: object({}),
    annotations: read,
    run: (_args, c) =>
      answer(c.workspace.listStatusPages(c.principal), (list) =>
        list.map((p) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          url: p.customDomain ? `https://${p.customDomain}/` : `${c.origin}/s/${p.slug}`,
          monitorIds: p.components.map((x) => x.monitorId),
        })),
      ),
  },
];
