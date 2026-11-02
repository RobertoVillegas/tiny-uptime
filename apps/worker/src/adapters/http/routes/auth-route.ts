import { failWith } from "../respond";
import type { Ctx, Handler } from "../router";
import { authStore, sameOrigin, signedIn, type CurrentSession } from "../session";

export type AuthCtx = Ctx & { store: ReturnType<typeof authStore> };
export type AccountCtx = AuthCtx & { session: CurrentSession };

/** Every /auth route refuses cross-origin writes; the panel always calls from our origin. */
export function authRoute(handler: (ctx: AuthCtx) => Promise<Response>): Handler {
  return (ctx) => {
    if (!sameOrigin(ctx.request, ctx.url)) return failWith(403, "forbidden", "cross-origin request refused");
    return handler({ ...ctx, store: authStore(ctx.env) });
  };
}

/** Routes for a complete sign-in only, not one still waiting for its second factor. */
export function accountRoute(handler: (ctx: AccountCtx) => Promise<Response>): Handler {
  return authRoute(async (ctx) => {
    const session = await signedIn(ctx.request, ctx.env);
    if (!session) return failWith(401, "unauthorized", "sign in first");
    return handler({ ...ctx, session });
  });
}
