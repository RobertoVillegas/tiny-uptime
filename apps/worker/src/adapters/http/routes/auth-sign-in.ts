import { CodeInput, InviteCompleteInput, InviteOptionsInput, LoginCompleteInput, RecoveryInput, TokenInput } from "@tiny-uptime/contracts";
import { readBody } from "../request";
import { failWith, fail, json, rejected, reply } from "../respond";
import type { Router } from "../router";
import { clearSession, currentSession, forgetSession, withSession } from "../session";
import { accountRoute, authRoute } from "./auth-route";

/** Invites, sign-up, sign-in, second factor, recovery and sign-out. */
export function signInRoutes(router: Router): void {
  router
    .get(
      "/auth/invite",
      authRoute(async (c) => reply(await c.store.inviteInfo(c.url.searchParams.get("token") ?? ""))),
    )
    .post(
      "/auth/invite/options",
      authRoute(async (c) => {
        const input = await readBody(c.request, InviteOptionsInput);
        if (input.isErr()) return rejected(input.error);
        return reply(await c.store.startSignUp(c.url.origin, input.value.token, input.value.name));
      }),
    )
    .post(
      "/auth/invite/complete",
      authRoute(async (c) => {
        const input = await readBody(c.request, InviteCompleteInput);
        if (input.isErr()) return rejected(input.error);
        const result = await c.store.completeSignUp(c.url.origin, input.value);
        if (result.status === "error") return fail(result.error);
        return withSession(json(201, { stage: "full", recoveryCodes: result.value.recoveryCodes }), result.value.session);
      }),
    )
    .post(
      "/auth/invite/accept",
      accountRoute(async (c) => {
        const input = await readBody(c.request, TokenInput);
        if (input.isErr()) return rejected(input.error);
        forgetSession(c.session.hash);
        return reply(await c.store.acceptInvite(input.value.token, c.session.info.userId));
      }),
    )
    .post("/auth/login/options", authRoute(async (c) => json(200, await c.store.startSignIn(c.url.origin))))
    .post(
      "/auth/login/complete",
      authRoute(async (c) => {
        const input = await readBody(c.request, LoginCompleteInput);
        if (input.isErr()) return rejected(input.error);
        const result = await c.store.completeSignIn(c.url.origin, input.value);
        if (result.status === "error") return fail(result.error);
        return withSession(json(200, { stage: result.value.stage }), result.value.session);
      }),
    )
    .post(
      "/auth/mfa",
      authRoute(async (c) => {
        const session = await currentSession(c.request, c.env);
        if (!session || session.info.stage !== "mfa") return failWith(401, "unauthorized", "no sign-in is waiting for a code");
        const input = await readBody(c.request, CodeInput);
        if (input.isErr()) return rejected(input.error);
        forgetSession(session.hash);
        const result = await c.store.completeMfa(session.hash, input.value.code);
        if (result.status === "error") return fail(result.error);
        return withSession(json(200, { stage: "full" }), result.value.session);
      }),
    )
    .post(
      "/auth/recovery",
      authRoute(async (c) => {
        const input = await readBody(c.request, RecoveryInput);
        if (input.isErr()) return rejected(input.error);
        const result = await c.store.recover(input.value.email, input.value.code);
        if (result.status === "error") return fail(result.error);
        return withSession(json(200, { stage: "full", addPasskey: true }), result.value.session);
      }),
    )
    .post(
      "/auth/logout",
      authRoute(async (c) => {
        const session = await currentSession(c.request, c.env);
        if (session) {
          await c.store.endSession(session.hash);
          forgetSession(session.hash);
        }
        return clearSession(json(200, { ok: true }));
      }),
    );
}
