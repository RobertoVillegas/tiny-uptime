import { ChannelInput, ChannelPatch } from "@tiny-uptime/contracts";
import { presentChannel } from "../presenters";
import { readBody } from "../request";
import { rejected, reply } from "../respond";
import type { Router } from "../router";
import { workspaceRoute } from "./workspace-route";

export function channelRoutes(router: Router): void {
  router
    .get(
      "/api/v1/channels",
      workspaceRoute(async (c) => reply(await c.workspace.listChannels(c.principal), (list) => list.map(presentChannel))),
    )
    .post(
      "/api/v1/channels",
      workspaceRoute(async (c) => {
        const input = await readBody(c.request, ChannelInput);
        if (input.isErr()) return rejected(input.error);
        return reply(await c.workspace.createChannel(c.principal, input.value), presentChannel, 201);
      }),
    )
    .patch(
      "/api/v1/channels/:id",
      workspaceRoute(async (c) => {
        const patch = await readBody(c.request, ChannelPatch);
        if (patch.isErr()) return rejected(patch.error);
        return reply(await c.workspace.updateChannel(c.principal, c.params.id!, patch.value), presentChannel);
      }),
    )
    .delete(
      "/api/v1/channels/:id",
      workspaceRoute(async (c) => reply(await c.workspace.deleteChannel(c.principal, c.params.id!), undefined, 204)),
    )
    .post(
      "/api/v1/channels/:id/test",
      workspaceRoute(async (c) => reply(await c.workspace.testChannel(c.principal, c.params.id!), () => ({ delivered: true }))),
    );
}
