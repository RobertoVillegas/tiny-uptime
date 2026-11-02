import { Result } from "better-result";
import type { ChannelInput, ChannelPatch } from "@tiny-uptime/contracts";
import type { Channel } from "../../domain/channel";
import { testAlert } from "../../domain/incident";
import { Invalid, NotFound, type DeliveryFailed } from "../../errors";
import type { WorkspaceDeps } from "./deps";

export function listChannels(d: WorkspaceDeps): Channel[] {
  return d.channels.list();
}

export function createChannel(d: WorkspaceDeps, input: ChannelInput): Channel {
  const channel: Channel = { id: d.ids.id(), ...input, createdAt: d.clock.now() };
  d.channels.insert(channel);
  return channel;
}

export function updateChannel(d: WorkspaceDeps, id: string, patch: ChannelPatch): Result<Channel, NotFound | Invalid> {
  return Result.gen(function* () {
    const current = yield* getChannel(d, id);
    if (patch.type !== undefined && patch.type !== current.type)
      return Result.err(new Invalid({ field: "type", message: "type: cannot be changed" }));
    const { type: _type, ...changes } = patch;
    const updated: Channel = { ...current, ...definedOnly(changes) };
    d.channels.save(updated);
    return Result.ok(updated);
  });
}

export function deleteChannel(d: WorkspaceDeps, id: string): Result<void, NotFound> {
  return getChannel(d, id).map(() => {
    d.channels.delete(id);
    d.deliveries.removeForChannel(id);
  });
}

export async function testChannel(d: WorkspaceDeps, id: string): Promise<Result<void, NotFound | DeliveryFailed>> {
  return Result.gen(async function* () {
    const channel = yield* getChannel(d, id);
    yield* Result.await(d.notifier.send(channel, testAlert(d.ids.id(6), d.clock.now())));
    return Result.ok(undefined);
  });
}

function getChannel(d: WorkspaceDeps, id: string): Result<Channel, NotFound> {
  const channel = d.channels.get(id);
  return channel ? Result.ok(channel) : Result.err(new NotFound({ message: "channel not found" }));
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
