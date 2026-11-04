import * as v from "valibot";

export type Incident = {
  id: string;
  monitorId: string;
  monitorName: string | null;
  /** `down` is an outage; `slow` is a minor incident for slow responses. */
  kind: "down" | "slow";
  startedAt: string;
  resolvedAt: string | null;
  cause: string;
  acknowledgedAt: string | null;
  /** False when nobody was alerted: the monitor's dependency was down. */
  notified: boolean;
  /** Opened by a person; `monitorId` is empty and `affects` names the monitors (none means all). */
  declared: boolean;
  affects: string[];
};

/** Tells status page visitors about something no monitor sees, such as a slow payment provider. */
export const DeclareIncident = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  /** `down` shows as an outage on status pages, `slow` as degraded performance. */
  kind: v.optional(v.picklist(["down", "slow"]), "down"),
  /** The monitors it affects; none means every monitor on a page. */
  monitorIds: v.optional(v.pipe(v.array(v.pipe(v.string(), v.maxLength(64))), v.maxLength(100)), []),
  /** The first public update; visitors read it under the incident. */
  message: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2000)),
});
export type DeclareIncident = v.InferOutput<typeof DeclareIncident>;
export type DeclareIncidentDraft = v.InferInput<typeof DeclareIncident>;

/** Closes a declared incident, optionally with a last public note. */
export const ResolveIncident = v.object({ message: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000))) });
export type ResolveIncident = v.InferOutput<typeof ResolveIncident>;

export const MAX_INCIDENTS_PAGE = 200;
