/**
 * Each entry runs once, in order, inside the workspace's own SQLite database. Append new
 * entries; never edit one that has shipped.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE monitor (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT NOT NULL,
    interval_sec INTEGER NOT NULL,
    paused INTEGER NOT NULL DEFAULT 0,
    public INTEGER NOT NULL DEFAULT 0,
    heartbeat_token TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    failures INTEGER NOT NULL DEFAULT 0,
    open_incident TEXT,
    next_at INTEGER,
    last_at INTEGER,
    last_ms INTEGER,
    last_detail TEXT,
    changed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE rollup (
    monitor_id TEXT NOT NULL,
    hour INTEGER NOT NULL,
    checks INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    ms_sum INTEGER NOT NULL,
    ms_count INTEGER NOT NULL,
    PRIMARY KEY (monitor_id, hour)
  ) WITHOUT ROWID;
  CREATE TABLE incident (
    id TEXT PRIMARY KEY,
    monitor_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    resolved_at INTEGER,
    cause TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX incident_started ON incident (started_at);
  CREATE TABLE api_key (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    hint TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  ) WITHOUT ROWID;
  CREATE TABLE channel (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE delivery (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL,
    last_error TEXT
  ) WITHOUT ROWID;
  `,
];
