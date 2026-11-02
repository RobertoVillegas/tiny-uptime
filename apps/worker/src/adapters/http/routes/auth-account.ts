import { AddPasskeyInput, CodeInput, InviteMemberInput, RoleInput, type Me } from "@tiny-uptime/contracts";
import type { accounts } from "@tiny-uptime/core";
import { readBody } from "../request";
import { failWith, json, rejected, reply } from "../respond";
import type { Router } from "../router";
import { accountRoute, type AccountCtx } from "./auth-route";

/** The signed-in user's own account: profile, passkeys, TOTP, recovery codes, sessions, and workspace members. */
export function accountRoutes(router: Router): void {
  router
    .get(
      "/auth/me",
      accountRoute(async (c) => {
        const security = await c.store.security(c.session.info.userId);
        return json(200, { ...c.session.info, stage: "full", ...security } satisfies Me);
      }),
    )
    .delete(
      "/auth/sessions/others",
      accountRoute(async (c) => {
        await c.store.endOtherSessions(c.session.info.userId, c.session.hash);
        return json(200, { ok: true });
      }),
    )
    .post("/auth/passkeys/options", accountRoute(async (c) => json(200, await c.store.startAddPasskey(c.url.origin, c.session.info))))
    .post(
      "/auth/passkeys",
      accountRoute(async (c) => {
        const input = await readBody(c.request, AddPasskeyInput);
        if (input.isErr()) return rejected(input.error);
        return reply(await c.store.addPasskey(c.url.origin, c.session.info.userId, input.value), () => ({ ok: true }), 201);
      }),
    )
    .delete(
      "/auth/passkeys/:id",
      accountRoute(async (c) => reply(await c.store.removePasskey(c.session.info.userId, c.params.id!), () => ({ ok: true }))),
    )
    .post("/auth/totp/setup", accountRoute(async (c) => reply(await c.store.startTotp(c.session.info.userId))))
    .post("/auth/totp/confirm", accountRoute(withCode((c, code) => c.store.confirmTotp(c.session.info.userId, code))))
    .post("/auth/totp/disable", accountRoute(withCode((c, code) => c.store.disableTotp(c.session.info.userId, code))))
    .post(
      "/auth/recovery-codes",
      accountRoute(async (c) => reply(await c.store.issueRecoveryCodes(c.session.info.userId), (codes) => ({ codes }))),
    )
    .get("/auth/workspaces/:workspaceId/members", accountRoute(asMember(async (c, actor) => json(200, await c.store.listMembers(actor)))))
    .post(
      "/auth/workspaces/:workspaceId/invites",
      accountRoute(
        asMember(async (c, actor) => {
          const input = await readBody(c.request, InviteMemberInput);
          if (input.isErr()) return rejected(input.error);
          const { email, role } = input.value;
          return reply(await c.store.inviteMember(actor, email, role), (token) => ({ inviteUrl: `${c.url.origin}/app/invite?token=${token}`, email, role }), 201);
        }),
      ),
    )
    .patch(
      "/auth/workspaces/:workspaceId/members/:userId",
      accountRoute(
        asMember(async (c, actor) => {
          const input = await readBody(c.request, RoleInput);
          if (input.isErr()) return rejected(input.error);
          return reply(await c.store.setMemberRole(actor, c.params.userId!, input.value.role), () => ({ ok: true }));
        }),
      ),
    )
    .delete(
      "/auth/workspaces/:workspaceId/members/:userId",
      accountRoute(asMember(async (c, actor) => reply(await c.store.setMemberRole(actor, c.params.userId!, null), () => ({ ok: true })))),
    );
}

function withCode(run: (c: AccountCtx, code: string) => Promise<Parameters<typeof reply>[0]>) {
  return async (c: AccountCtx) => {
    const input = await readBody(c.request, CodeInput);
    if (input.isErr()) return rejected(input.error);
    return reply(await run(c, input.value.code), () => ({ ok: true }));
  };
}

/** Resolves the signed-in user's membership in the workspace named by the path. */
function asMember(run: (c: AccountCtx, actor: accounts.Actor) => Promise<Response>) {
  return (c: AccountCtx) => {
    const membership = c.session.info.memberships.find((m) => m.workspaceId === c.params.workspaceId);
    if (!membership) return Promise.resolve(failWith(404, "not_found", "workspace not found"));
    return run(c, { userId: c.session.info.userId, membership });
  };
}
