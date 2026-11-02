import { graceSecOf, type MonitorSettings } from "./monitor";

/**
 * Each monitor checks at a fixed offset inside its interval, derived from its id, so monitors
 * created together spread out instead of firing on the same tick.
 */
export function nextSlot(id: string, intervalSec: number, now: number): number {
  const interval = intervalSec * 1000;
  const phase = (fnv1a(id) % intervalSec) * 1000;
  return Math.floor((now - phase) / interval) * interval + interval + phase;
}

/** When a heartbeat monitor counts as missed if no ping arrives after `from`. */
export function heartbeatDeadline(settings: Pick<MonitorSettings, "intervalSec"> & Parameters<typeof graceSecOf>[0], from: number): number {
  return from + (settings.intervalSec + graceSecOf(settings)) * 1000;
}

/** A new or resumed monitor checks right away; a heartbeat waits for its first deadline. */
export function firstCheckAt(settings: MonitorSettings, now: number): number | null {
  if (settings.paused) return null;
  return settings.type === "heartbeat" ? heartbeatDeadline(settings, now) : now;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}
