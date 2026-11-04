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
  // 2: fastest and slowest response per hour, for the uptime bar details.
  `
  ALTER TABLE rollup ADD COLUMN ms_min INTEGER;
  ALTER TABLE rollup ADD COLUMN ms_max INTEGER;
  `,
  // 3: monitor options and counters, incident kinds and follow-ups, maintenance windows.
  `
  ALTER TABLE monitor ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE monitor ADD COLUMN successes INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE monitor ADD COLUMN slow_streak INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE monitor ADD COLUMN open_slow_incident TEXT;
  ALTER TABLE incident ADD COLUMN kind TEXT NOT NULL DEFAULT 'down';
  ALTER TABLE incident ADD COLUMN acknowledged_at INTEGER;
  ALTER TABLE incident ADD COLUMN acknowledged_by TEXT;
  ALTER TABLE incident ADD COLUMN notified INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE incident ADD COLUMN reminders INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE incident ADD COLUMN last_reminder_at INTEGER;
  ALTER TABLE incident ADD COLUMN escalated_at INTEGER;
  CREATE INDEX incident_open ON incident (resolved_at) WHERE resolved_at IS NULL;
  CREATE TABLE maintenance (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    monitor_ids TEXT NOT NULL,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    recurrence TEXT,
    created_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  `,
  // 4: status pages and their components, incident updates, and daily history for 90-day bars.
  `
  CREATE TABLE status_page (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    theme TEXT NOT NULL DEFAULT 'auto',
    show_latency INTEGER NOT NULL DEFAULT 1,
    external_url TEXT,
    hide_branding INTEGER NOT NULL DEFAULT 0,
    ok_pct REAL NOT NULL DEFAULT 99.9,
    warn_pct REAL NOT NULL DEFAULT 98,
    custom_domain TEXT UNIQUE,
    created_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE status_component (
    page_id TEXT NOT NULL,
    monitor_id TEXT NOT NULL,
    group_name TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (page_id, monitor_id)
  ) WITHOUT ROWID;
  CREATE TABLE incident_update (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL,
    status TEXT NOT NULL,
    body TEXT NOT NULL,
    visibility TEXT NOT NULL,
    author TEXT,
    created_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX incident_update_incident ON incident_update (incident_id, created_at);
  CREATE TABLE rollup_daily (
    monitor_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    checks INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    PRIMARY KEY (monitor_id, day)
  ) WITHOUT ROWID;
  INSERT INTO rollup_daily (monitor_id, day, checks, ok)
    SELECT monitor_id, (hour / 86400000) * 86400000, sum(checks), sum(ok) FROM rollup GROUP BY monitor_id, (hour / 86400000);
  `,
  // 5: status page language, time zone, history and incident ranges, and history resets.
  `
  ALTER TABLE status_page ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
  ALTER TABLE status_page ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC';
  ALTER TABLE status_page ADD COLUMN history_days INTEGER NOT NULL DEFAULT 90;
  ALTER TABLE status_page ADD COLUMN incident_days INTEGER NOT NULL DEFAULT 14;
  ALTER TABLE status_page ADD COLUMN history_reset_at INTEGER;
  `,
  // 6: incidents declared by people, which name the monitors they affect instead of having one.
  `
  ALTER TABLE incident ADD COLUMN declared INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE incident ADD COLUMN affects TEXT;
  `,
];
