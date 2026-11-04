import type { Region } from "@tiny-uptime/contracts";
import type { CheckOutcome } from "./health";

/** What one region saw. Null when it could not be asked or did not answer in time. */
export type RegionAnswer = { region: Region; outcome: CheckOutcome | null };

/**
 * Folds the regions' answers into the one outcome a run records. The run fails when a strict
 * majority of the regions that answered failed, so a bad route from one location pages nobody.
 * A region that did not answer says nothing about the target and is left out of the vote.
 * Null when none answered.
 */
export function voteOnRegions(answers: RegionAnswer[]): CheckOutcome | null {
  const answered = answers.filter((a): a is { region: Region; outcome: CheckOutcome } => a.outcome !== null);
  if (answered.length === 0) return null;
  const failed = answered.filter((a) => !a.outcome.ok);
  const ok = failed.length * 2 <= answered.length;
  const winners = answered.filter((a) => a.outcome.ok === ok);
  const losers = answered.filter((a) => a.outcome.ok !== ok);
  const silent = answers.filter((a) => a.outcome === null).map((a) => a.region);

  const parts = ok ? [winners[0]!.outcome.detail] : byDetail(winners);
  if (losers.length) parts.push(...(ok ? byDetail(losers) : [`up from ${losers.map((a) => a.region).join(", ")}`]));
  if (silent.length) parts.push(`no answer from ${silent.join(", ")}`);
  return { ok, latencyMs: median(winners.map((a) => a.outcome.latencyMs)), detail: parts.join("; ") };
}

/** Failures grouped by what went wrong: "HTTP 503 from weur, apac". */
function byDetail(failed: { region: Region; outcome: CheckOutcome }[]): string[] {
  const groups = new Map<string, Region[]>();
  for (const { region, outcome } of failed) groups.set(outcome.detail, [...(groups.get(outcome.detail) ?? []), region]);
  return [...groups].map(([detail, regions]) => `${detail} from ${regions.join(", ")}`);
}

function median(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v !== null).toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
