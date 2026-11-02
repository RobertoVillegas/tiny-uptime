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
CREATE TABLE IF NOT EXISTS oauth_client (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS oauth_grant (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  scopes TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS oauth_grant_user ON oauth_grant (user_id);
CREATE TABLE IF NOT EXISTS oauth_code (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS oauth_token (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS oauth_token_grant ON oauth_token (grant_id);
`;
