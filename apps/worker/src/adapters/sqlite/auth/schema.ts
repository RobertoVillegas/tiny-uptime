/** The accounts database. Every statement is idempotent, so it runs on each start. */
export const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  totp_secret TEXT,
  totp_pending TEXT,
  totp_last_step INTEGER,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS membership (
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, workspace_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS passkey (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  transports TEXT NOT NULL,
  counter INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS passkey_user ON passkey (user_id);
CREATE TABLE IF NOT EXISTS session (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS challenge (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  purpose TEXT NOT NULL,
  subject TEXT,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS invite (
  hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS recovery_code (
  user_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (user_id, hash)
) WITHOUT ROWID;
`;
