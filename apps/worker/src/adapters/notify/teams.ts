import { Result } from "better-result";
import { DeliveryFailed, formatAlert, type AlertEvent, type ChannelOf } from "@tiny-uptime/core";
import { deliverJson } from "./send";
import { clip } from "./text";

/** Teams rejects a message body over 4000 characters. */
const TEAMS_LIMIT = 4000;

/**
 * Microsoft Teams Workflow webhook ("When a Teams webhook request is received"), which accepts an Adaptive Card in a
 * message envelope. TextBlock text is Markdown, so its control characters are escaped before the length cap.
 */
export async function sendTeams(channel: ChannelOf<"teams">, event: AlertEvent): Promise<Result<void, DeliveryFailed>> {
  const sent = await deliverJson(channel.url, {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.2",
          body: [{ type: "TextBlock", text: clip(escapeMarkdown(formatAlert(event).text), TEAMS_LIMIT), wrap: true }],
          ...(event.link ? { actions: [{ type: "Action.OpenUrl", title: "View incident", url: event.link }] } : {}),
          msteams: { width: "Full" },
        },
      },
    ],
  });
  // a Workflow whose trigger requires a signed-in user answers 401 or 403; say how to fix it
  if (sent.isErr() && /HTTP (401|403)\b/.test(sent.error.message)) {
    const hint = "the Workflow must be triggerable by anyone; authenticated triggers are not supported";
    return Result.err(new DeliveryFailed({ message: `${sent.error.message} (${hint})` }));
  }
  return sent;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_[\]()`]/g, (c) => `\\${c}`);
}
