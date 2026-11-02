import type { Notifier } from "@tiny-uptime/core";
import { sendDiscord } from "./discord";
import { sendEmail, type EmailSetup } from "./email";
import { sendLark } from "./lark";
import { sendNtfy } from "./ntfy";
import { sendPagerDuty } from "./pagerduty";
import { sendSlack } from "./slack";
import { sendTeams } from "./teams";
import { sendTelegram } from "./telegram";
import { sendWebhook } from "./webhook";

/** Sends each alert the way its channel's type expects. Only email needs anything from the environment. */
export function createNotifier(env: EmailSetup): Notifier {
  return {
    send(channel, event) {
      switch (channel.type) {
        case "webhook":
          return sendWebhook(channel, event);
        case "slack":
          return sendSlack(channel, event);
        case "discord":
          return sendDiscord(channel, event);
        case "teams":
          return sendTeams(channel, event);
        case "ntfy":
          return sendNtfy(channel, event);
        case "lark":
          return sendLark(channel, event);
        case "telegram":
          return sendTelegram(channel, event);
        case "pagerduty":
          return sendPagerDuty(channel, event);
        case "email":
          return sendEmail(env, channel, event);
      }
    },
  };
}
