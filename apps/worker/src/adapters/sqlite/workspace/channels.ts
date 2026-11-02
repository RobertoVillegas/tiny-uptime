import { channelSettings, type Channel, type ChannelRepository, type Delivery, type DeliveryRepository } from "@tiny-uptime/core";
import { bool, first, json } from "../rows";

type ChannelRow = { id: string; type: Channel["type"]; name: string; config: string; enabled: number; created_at: number };
type DeliveryRow = { id: string; channel_id: string; payload: string; attempts: number; next_at: number; last_error: string | null };

export class SqliteChannels implements ChannelRepository {
  constructor(private readonly sql: SqlStorage) {}

  list(): Channel[] {
    return this.sql.exec<ChannelRow>("SELECT * FROM channel ORDER BY created_at").toArray().map(toChannel);
  }

  enabled(): Channel[] {
    return this.sql.exec<ChannelRow>("SELECT * FROM channel WHERE enabled = 1 ORDER BY created_at").toArray().map(toChannel);
  }

  get(id: string): Channel | null {
    const row = first(this.sql.exec<ChannelRow>("SELECT * FROM channel WHERE id = ?", id));
    return row && toChannel(row);
  }

  insert(c: Channel): void {
    this.sql.exec(
      "INSERT INTO channel (id, type, name, config, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      c.id,
      c.type,
      c.name,
      JSON.stringify(channelSettings(c)),
      c.enabled ? 1 : 0,
      c.createdAt,
    );
  }

  save(c: Channel): void {
    this.sql.exec(
      "UPDATE channel SET name = ?, config = ?, enabled = ? WHERE id = ?",
      c.name,
      JSON.stringify(channelSettings(c)),
      c.enabled ? 1 : 0,
      c.id,
    );
  }

  delete(id: string): void {
    this.sql.exec("DELETE FROM channel WHERE id = ?", id);
  }
}

export class SqliteDeliveries implements DeliveryRepository {
  constructor(private readonly sql: SqlStorage) {}

  enqueue(d: Delivery): void {
    this.sql.exec(
      "INSERT INTO delivery (id, channel_id, payload, attempts, next_at, last_error) VALUES (?, ?, ?, ?, ?, ?)",
      d.id,
      d.channelId,
      d.payload,
      d.attempts,
      d.nextAt,
      d.lastError,
    );
  }

  due(now: number): Delivery[] {
    return this.sql.exec<DeliveryRow>("SELECT * FROM delivery WHERE next_at <= ?", now).toArray().map(toDelivery);
  }

  reschedule(id: string, attempts: number, nextAt: number, error: string): void {
    this.sql.exec("UPDATE delivery SET attempts = ?, next_at = ?, last_error = ? WHERE id = ?", attempts, nextAt, error, id);
  }

  remove(id: string): void {
    this.sql.exec("DELETE FROM delivery WHERE id = ?", id);
  }

  removeForChannel(channelId: string): void {
    this.sql.exec("DELETE FROM delivery WHERE channel_id = ?", channelId);
  }
}

/**
 * `config` holds the settings of the channel's type as JSON. Webhook rows written before other types existed hold
 * `{ "url": … }`, which is exactly a webhook's settings, so they read unchanged.
 */
function toChannel(row: ChannelRow): Channel {
  return {
    ...json<Record<string, unknown>>(row.config),
    id: row.id,
    type: row.type,
    name: row.name,
    enabled: bool(row.enabled),
    createdAt: row.created_at,
  } as Channel;
}

function toDelivery(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    channelId: row.channel_id,
    payload: row.payload,
    attempts: row.attempts,
    nextAt: row.next_at,
    lastError: row.last_error,
  };
}
