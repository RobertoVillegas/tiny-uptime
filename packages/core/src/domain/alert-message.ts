import type { AlertEvent } from "./incident";

/** How an alert reads to people, for every channel that is not the raw webhook. */
export type AlertMessage = {
  /** `down` covers reminders and escalations of an outage; `slow` the same for a latency incident. */
  tone: "down" | "slow" | "up" | "test";
  /** A heading without decoration: "Site is down". */
  title: string;
  /** The emoji `text` starts with, for subjects and titles that want one. */
  emoji: string;
  /** One line for chat channels, worded and decorated as OpenUptime's: "🔴 Site is down — HTTP 503". */
  text: string;
  /** A few plain lines with the details, for email and other long-form channels. */
  body: string;
};

const EMOJI = { down: "🔴", slow: "🟡", up: "✅", test: "🔔" } as const;

/** Mirrors OpenUptime's wording, so people who switch read the same alerts. */
export function formatAlert(event: AlertEvent): AlertMessage {
  if (event.test) {
    const title = "Test alert from tiny-uptime";
    return {
      tone: "test",
      title,
      emoji: EMOJI.test,
      text: `${EMOJI.test} ${title} — this channel is connected.`,
      body: "This channel is connected. When a monitor goes down or recovers, you get a message like this one here.",
    };
  }
  const name = event.monitor.name;
  const state = event.slow ? "is responding slowly" : "is down";
  const still = event.slow ? "is still responding slowly" : "is still down";
  const tone = event.kind === "resolved" ? "up" : event.slow ? "slow" : "down";
  let title: string;
  let emoji: string = EMOJI[tone];
  let text: string;
  let intro: string;
  switch (event.kind) {
    case "opened":
      title = `${name} ${state}`;
      text = `${emoji} ${title} — ${event.incident.title}`;
      intro = event.slow
        ? "The monitor responded slower than its threshold on several checks in a row, so an incident was opened."
        : "The monitor failed its consecutive checks, so an incident was opened.";
      break;
    case "reminder":
      title = `${name} ${still}`;
      emoji = "⏰";
      text = `${emoji} ${title} and nobody has acknowledged it — reminder ${event.count ?? 1}`;
      intro = `Nobody has acknowledged this incident yet. This is reminder ${event.count ?? 1}.`;
      break;
    case "escalated":
      title = `${name} ${still}`;
      emoji = "🚨";
      text = `${emoji} ${title} and nobody has acknowledged it — escalated to you`;
      intro = "Nobody acknowledged this incident in time, so it was escalated to this channel.";
      break;
    case "resolved":
      title = event.slow ? `${name} is back to normal` : `${name} has recovered`;
      text = `${emoji} ${title}`;
      intro = event.slow
        ? "Responses are within the threshold again and the incident is resolved."
        : "Checks are passing again and the incident is resolved.";
      break;
  }
  return { tone, title, emoji, text, body: [intro, "", ...rows(event)].join("\n") };
}

function rows(event: AlertEvent): string[] {
  const { incident, monitor } = event;
  const out = [`Monitor: ${monitor.name}`];
  if (monitor.target) out.push(`Target: ${monitor.target}`);
  if (event.kind !== "resolved") out.push(`Cause: ${incident.title}`);
  out.push(`Started: ${utc(incident.startedAt)}`);
  if (incident.resolvedAt !== null) {
    out.push(`${event.slow ? "Slow for" : "Downtime"}: ${duration(incident.resolvedAt - incident.startedAt)}`);
    out.push(`Resolved: ${utc(incident.resolvedAt)}`);
  }
  return out;
}

function utc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Minutes, at least one, then hours and minutes: "4 min", "2 h 5 min". */
export function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""}`;
}
