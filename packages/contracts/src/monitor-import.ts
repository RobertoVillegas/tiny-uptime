import * as v from "valibot";
import { hostIsPrivate } from "./public-host";

/**
 * Monitors to import. Each item is a monitor as `GET /api/v1/monitors` returns it (so an export from
 * one workspace imports into another as is): `id` and `dependsOn` refer to the source, channels are
 * left out because they belong to the source workspace, and fields the API adds are ignored.
 */
export const MonitorImportInput = v.object({
  monitors: v.pipe(v.array(v.record(v.string(), v.unknown())), v.minLength(1), v.maxLength(500)),
  /** Report what would happen without creating anything. */
  dryRun: v.optional(v.boolean(), false),
});
export type MonitorImportInput = v.InferOutput<typeof MonitorImportInput>;

export type ImportRowStatus = "ready" | "created" | "duplicate" | "invalid";

export type ImportRow = {
  name: string;
  type: string;
  status: ImportRowStatus;
  /** The monitor created, or the existing one a duplicate matches. */
  monitorId: string | null;
  /** Why it is invalid, or what it duplicates. */
  message: string | null;
  /** What did not carry over exactly. */
  notes: string[];
};

export type ImportReport = { dryRun: boolean; rows: ImportRow[]; created: number; duplicates: number; invalid: number };

/** An OpenUptime instance to copy monitors from, read with one of its API keys. The key is used once and not stored. */
export const OpenUptimeImportInput = v.object({
  url: v.pipe(
    v.string(),
    v.trim(),
    v.url("must be a URL"),
    v.regex(/^https:\/\//i, "must be an https URL"),
    v.check((u) => !hostIsPrivate(new URL(u).hostname), "cannot point at a private or internal host"),
  ),
  apiKey: v.pipe(v.string(), v.trim(), v.minLength(10, "is required"), v.maxLength(500)),
  dryRun: v.optional(v.boolean(), true),
});
export type OpenUptimeImportInput = v.InferOutput<typeof OpenUptimeImportInput>;
