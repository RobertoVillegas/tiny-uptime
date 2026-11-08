import { HISTORY_RANGES, type HistoryRange, type StatusPage, type StatusPageDraft } from "@tiny-uptime/contracts";
import { browserTimezone } from "../../lib/zoned";

/** The editor's state: what the inputs hold, with numbers kept as typed until the page is saved. */
export type Draft = Required<
  Pick<StatusPageDraft, "title" | "slug" | "description" | "theme" | "language" | "timeZone" | "showLatency" | "hideBranding">
> & {
  historyDays: `${HistoryRange}`;
  incidentDays: `${HistoryRange}`;
  externalUrl: string;
  customDomain: string;
  okPct: string;
  warnPct: string;
  components: { monitorId: string; group: string }[];
};

export function draftOf(page?: StatusPage): Draft {
  return {
    title: page?.title ?? "",
    slug: page?.slug ?? "",
    description: page?.description ?? "",
    theme: page?.theme ?? "auto",
    language: page?.language ?? "en",
    timeZone: page?.timeZone ?? (browserTimezone() || "UTC"),
    historyDays: `${page?.historyDays ?? 90}`,
    incidentDays: `${page?.incidentDays ?? 14}`,
    showLatency: page?.showLatency ?? true,
    hideBranding: page?.hideBranding ?? false,
    externalUrl: page?.externalUrl ?? "",
    customDomain: page?.customDomain ?? "",
    okPct: String(page?.okPct ?? 99.9),
    warnPct: String(page?.warnPct ?? 98),
    components: page?.components.map((c) => ({ monitorId: c.monitorId, group: c.group })) ?? [],
  };
}

export function inputOf(d: Draft): StatusPageDraft {
  return {
    ...d,
    externalUrl: d.externalUrl.trim() || null,
    customDomain: d.customDomain.trim() || null,
    okPct: Number(d.okPct),
    warnPct: Number(d.warnPct),
    historyDays: rangeOf(d.historyDays),
    incidentDays: rangeOf(d.incidentDays),
  };
}

function rangeOf(value: `${HistoryRange}`): HistoryRange {
  return HISTORY_RANGES.find((days) => `${days}` === value) ?? 90;
}

export const RANGE_OPTIONS = HISTORY_RANGES.map((days) => ({
  value: `${days}` as const,
  label: days === 1 ? "24 hours, hour by hour" : `${days} days`,
}));
