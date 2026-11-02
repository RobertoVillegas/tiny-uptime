import { Result } from "better-result";
import { DeliveryFailed, formatAlert, type AlertEvent, type ChannelOf } from "@tiny-uptime/core";
import { errorText } from "../checks/timeout";

/** The parts of the Worker's environment email needs: the Email Service binding and a verified sender. */
export type EmailSetup = { EMAIL?: SendEmail; EMAIL_FROM?: string };

/**
 * Sends a plain-text alert through Cloudflare Email Service. Without the `EMAIL` binding or `EMAIL_FROM` the delivery
 * fails with what to set up: it is retried like any other, so mail starts flowing once the operator adds them.
 */
export async function sendEmail(setup: EmailSetup, channel: ChannelOf<"email">, event: AlertEvent): Promise<Result<void, DeliveryFailed>> {
  if (!setup.EMAIL || !setup.EMAIL_FROM) {
    return Result.err(
      new DeliveryFailed({ message: "email is not set up on this server: add the EMAIL send_email binding and EMAIL_FROM" }),
    );
  }
  const message = formatAlert(event);
  try {
    await setup.EMAIL.send({
      from: { email: setup.EMAIL_FROM, name: "tiny-uptime alerts" },
      to: channel.to,
      subject: `${message.emoji} ${message.title} · tiny-uptime`,
      text: message.body,
    });
    return Result.ok(undefined);
  } catch (error) {
    return Result.err(new DeliveryFailed({ message: `email to ${channel.to}: ${errorText(error)}` }));
  }
}
