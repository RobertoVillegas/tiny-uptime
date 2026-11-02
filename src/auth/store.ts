import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { newId, randomHex, sha256Hex } from "../lib/ids";
import { newTotpSecret, verifyTotp } from "./totp";

export type Role = "owner" | "editor" | "viewer";
export const ROLES: readonly Role[] = ["owner", "editor", "viewer"];

export type Membership = { workspaceId: string; workspaceName: string; role: Role };
export type SessionInfo = { userId: string; email: string; name: string; stage: "full" | "mfa"; memberships: Membership[] };
export type StoredPasskey = { id: string; userId: string; publicKey: string; algorithm: "ES256" | "RS256" | "EdDSA"; transports: string[]; counter: number };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const SESSION_TTL_MS = 30 * DAY;
const MFA_SESSION_TTL_MS = 10 * MINUTE;
const CHALLENGE_TTL_MS = 5 * MINUTE;
const INVITE_TTL_MS = 7 * DAY;
/** Failed second-factor or recovery attempts before the account is locked for a while. */
const MAX_FAILURES = 5;
const LOCK_MS = 15 * MINUTE;
const RECOVERY_CODES = 10;
const TOUCH_MS = 60 * MINUTE;

const SCHEMA = `
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

/**
 * Accounts for the whole instance: users, their passkeys and second factor, sessions, invitations
 * and which workspaces each user belongs to. Workspaces never see credentials, only a user id and role.
 */
export class AuthStore extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
  }

  // ---- challenges ----

  createChallenge(value: string, purpose: string, subject: string | null): string {
    const now = Date.now();
    this.sql.exec("DELETE FROM challenge WHERE expires_at < ?", now);
    const id = newId(16);
    this.sql.exec("INSERT INTO challenge (id, value, purpose, subject, expires_at) VALUES (?, ?, ?, ?, ?)", id, value, purpose, subject, now + CHALLENGE_TTL_MS);
    return id;
  }

  /** A challenge is used once: reading it deletes it. */
  takeChallenge(id: string, purpose: string): { value: string; subject: string | null } | null {
    const row = this.sql
      .exec<{ value: string; subject: string | null; purpose: string; expires_at: number }>("SELECT * FROM challenge WHERE id = ?", id)
      .toArray()[0];
    if (!row) return null;
    this.sql.exec("DELETE FROM challenge WHERE id = ?", id);
    if (row.purpose !== purpose || row.expires_at < Date.now()) return null;
    return { value: row.value, subject: row.subject };
  }

  // ---- invites ----

  async createInvite(email: string, workspaceId: string, workspaceName: string, role: Role): Promise<string> {
    const token = randomHex(24);
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO invite (hash, email, workspace_id, workspace_name, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      await sha256Hex(token), email.toLowerCase(), workspaceId, workspaceName, role, now + INVITE_TTL_MS, now,
    );
    return token;
  }

  async invite(token: string): Promise<{ email: string; workspaceName: string; role: Role; existingUser: boolean } | null> {
    const row = this.inviteRow(await sha256Hex(token));
    if (!row) return null;
    const existingUser = this.sql.exec("SELECT 1 FROM user WHERE email = ?", row.email).toArray().length > 0;
    return { email: row.email, workspaceName: row.workspace_name, role: row.role, existingUser };
  }

  /** Signs up the invited person with their first passkey. Existing users accept with acceptInvite instead. */
  async signUpWithInvite(
    token: string,
    name: string,
    passkey: Omit<StoredPasskey, "userId" | "counter"> & { counter: number; label: string },
  ): Promise<{ session: string; recoveryCodes: string[] } | { error: string }> {
    const hash = await sha256Hex(token);
    const invite = this.inviteRow(hash);
    if (!invite) return { error: "invite is invalid or expired" };
    if (this.sql.exec("SELECT 1 FROM user WHERE email = ?", invite.email).toArray().length) {
      return { error: "this email already has an account; sign in to accept the invite" };
    }
    const now = Date.now();
    const userId = newId();
    this.sql.exec("INSERT INTO user (id, email, name, created_at) VALUES (?, ?, ?, ?)", userId, invite.email, name, now);
    this.sql.exec(
      "INSERT INTO membership (user_id, workspace_id, workspace_name, role) VALUES (?, ?, ?, ?)",
      userId, invite.workspace_id, invite.workspace_name, invite.role,
    );
    this.insertPasskey(userId, passkey, now);
    this.sql.exec("DELETE FROM invite WHERE hash = ?", hash);
    const recoveryCodes = await this.replaceRecoveryCodes(userId);
    return { session: await this.createSession(userId, "full"), recoveryCodes };
  }

  async acceptInvite(token: string, userId: string): Promise<Membership | { error: string }> {
    const hash = await sha256Hex(token);
    const invite = this.inviteRow(hash);
    const user = this.userRow(userId);
    if (!invite || !user) return { error: "invite is invalid or expired" };
    if (invite.email !== user.email) return { error: "this invite is for another email" };
    this.sql.exec(
      `INSERT INTO membership (user_id, workspace_id, workspace_name, role) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = excluded.role, workspace_name = excluded.workspace_name`,
      userId, invite.workspace_id, invite.workspace_name, invite.role,
    );
    this.sql.exec("DELETE FROM invite WHERE hash = ?", hash);
    return { workspaceId: invite.workspace_id, workspaceName: invite.workspace_name, role: invite.role };
  }

  // ---- passkeys ----

  passkey(id: string): StoredPasskey | null {
    const row = this.sql
      .exec<{ id: string; user_id: string; public_key: string; algorithm: StoredPasskey["algorithm"]; transports: string; counter: number }>(
        "SELECT * FROM passkey WHERE id = ?",
        id,
      )
      .toArray()[0];
    return row
      ? { id: row.id, userId: row.user_id, publicKey: row.public_key, algorithm: row.algorithm, transports: JSON.parse(row.transports), counter: row.counter }
      : null;
  }

  /** Records a successful passkey sign-in and opens a session, waiting for the second factor if the user has one. */
  async signInWithPasskey(id: string, counter: number): Promise<{ session: string; stage: "full" | "mfa" } | { error: string }> {
    const key = this.passkey(id);
    if (!key) return { error: "unknown passkey" };
    const user = this.userRow(key.userId);
    if (!user) return { error: "unknown passkey" };
    const now = Date.now();
    this.sql.exec("UPDATE passkey SET counter = ?, last_used_at = ? WHERE id = ?", counter, now, id);
    const stage = user.totp_secret ? "mfa" : "full";
    return { session: await this.createSession(user.id, stage), stage };
  }

  addPasskey(userId: string, passkey: Omit<StoredPasskey, "userId"> & { label: string }): void {
    this.insertPasskey(userId, passkey, Date.now());
  }

  listPasskeys(userId: string): { id: string; name: string; createdAt: string; lastUsedAt: string | null }[] {
    return this.sql
      .exec<{ id: string; name: string; created_at: number; last_used_at: number | null }>(
        "SELECT id, name, created_at, last_used_at FROM passkey WHERE user_id = ? ORDER BY created_at",
        userId,
      )
      .toArray()
      .map((p) => ({ id: p.id, name: p.name, createdAt: iso(p.created_at)!, lastUsedAt: iso(p.last_used_at) }));
  }

  /** The last passkey cannot be removed: it would lock the user out. */
  removePasskey(userId: string, id: string): { ok: true } | { error: string } {
    const count = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM passkey WHERE user_id = ?", userId).toArray()[0]!.n;
    if (count <= 1) return { error: "you cannot remove your only passkey" };
    const removed = this.sql.exec("DELETE FROM passkey WHERE id = ? AND user_id = ?", id, userId).rowsWritten;
    return removed ? { ok: true } : { error: "passkey not found" };
  }

  // ---- second factor ----

  startTotp(userId: string): string | null {
    if (!this.userRow(userId)) return null;
    const secret = newTotpSecret();
    this.sql.exec("UPDATE user SET totp_pending = ? WHERE id = ?", secret, userId);
    return secret;
  }

  async confirmTotp(userId: string, code: string): Promise<boolean> {
    const user = this.userRow(userId);
    if (!user?.totp_pending) return false;
    const step = await verifyTotp(user.totp_pending, code, Date.now(), null);
    if (step === null) return false;
    this.sql.exec("UPDATE user SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = ? WHERE id = ?", step, userId);
    return true;
  }

  async disableTotp(userId: string, code: string): Promise<boolean> {
    if (!(await this.checkTotp(userId, code))) return false;
    this.sql.exec("UPDATE user SET totp_secret = NULL, totp_last_step = NULL WHERE id = ?", userId);
    return true;
  }

  /** Completes a sign-in waiting for its second factor; the session token is replaced. */
  async completeMfa(sessionHash: string, code: string): Promise<{ session: string } | { error: string }> {
    const session = this.sessionRow(sessionHash);
    if (!session || session.stage !== "mfa") return { error: "no sign-in is waiting for a code" };
    if (!(await this.checkTotp(session.user_id, code))) return { error: "invalid code" };
    this.sql.exec("DELETE FROM session WHERE hash = ?", sessionHash);
    return { session: await this.createSession(session.user_id, "full") };
  }

  // ---- recovery ----

  async replaceRecoveryCodes(userId: string): Promise<string[]> {
    this.sql.exec("DELETE FROM recovery_code WHERE user_id = ?", userId);
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODES; i++) {
      const code = `${newId(5)}-${newId(5)}`;
      codes.push(code);
      this.sql.exec("INSERT INTO recovery_code (user_id, hash) VALUES (?, ?)", userId, await sha256Hex(code));
    }
    return codes;
  }

  /** A recovery code replaces both factors once, so a user who lost their passkey can add a new one. */
  async signInWithRecoveryCode(email: string, code: string): Promise<{ session: string } | { error: string }> {
    const user = this.sql.exec<UserRow>("SELECT * FROM user WHERE email = ?", email.toLowerCase()).toArray()[0];
    const generic = { error: "invalid email or recovery code" };
    if (!user) return generic;
    const now = Date.now();
    if (user.locked_until && user.locked_until > now) return { error: "too many attempts; try again later" };
    const hash = await sha256Hex(code.trim().toLowerCase());
    const used = this.sql.exec("DELETE FROM recovery_code WHERE user_id = ? AND hash = ?", user.id, hash).rowsWritten;
    if (!used) {
      this.recordFailure(user, now);
      return generic;
    }
    this.sql.exec("UPDATE user SET failures = 0, locked_until = NULL WHERE id = ?", user.id);
    return { session: await this.createSession(user.id, "full") };
  }

  // ---- sessions ----

  /** Resolves a session token hash to its user and memberships; touches it at most once an hour. */
  session(hash: string): SessionInfo | null {
    const row = this.sessionRow(hash);
    if (!row) return null;
    const now = Date.now();
    if (row.expires_at < now) {
      this.sql.exec("DELETE FROM session WHERE hash = ?", hash);
      return null;
    }
    if (now - row.seen_at > TOUCH_MS) this.sql.exec("UPDATE session SET seen_at = ? WHERE hash = ?", now, hash);
    const user = this.userRow(row.user_id);
    if (!user) return null;
    return { userId: user.id, email: user.email, name: user.name, stage: row.stage, memberships: this.memberships(user.id) };
  }

  endSession(hash: string): void {
    this.sql.exec("DELETE FROM session WHERE hash = ?", hash);
  }

  endOtherSessions(userId: string, keepHash: string): void {
    this.sql.exec("DELETE FROM session WHERE user_id = ? AND hash <> ?", userId, keepHash);
  }

  profile(userId: string): { totpEnabled: boolean; recoveryCodesLeft: number } | null {
    const user = this.userRow(userId);
    if (!user) return null;
    const left = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM recovery_code WHERE user_id = ?", userId).toArray()[0]!.n;
    return { totpEnabled: user.totp_secret !== null, recoveryCodesLeft: left };
  }

  // ---- members ----

  members(workspaceId: string): { userId: string; email: string; name: string; role: Role }[] {
    return this.sql
      .exec<{ id: string; email: string; name: string; role: Role }>(
        "SELECT u.id, u.email, u.name, m.role FROM membership m JOIN user u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.email",
        workspaceId,
      )
      .toArray()
      .map((m) => ({ userId: m.id, email: m.email, name: m.name, role: m.role }));
  }

  pendingInvites(workspaceId: string): { email: string; role: Role; expiresAt: string }[] {
    return this.sql
      .exec<{ email: string; role: Role; expires_at: number }>(
        "SELECT email, role, expires_at FROM invite WHERE workspace_id = ? AND expires_at > ? ORDER BY created_at",
        workspaceId, Date.now(),
      )
      .toArray()
      .map((i) => ({ email: i.email, role: i.role, expiresAt: iso(i.expires_at)! }));
  }

  /** Changes or removes a member, refusing to leave a workspace without an owner. */
  setRole(workspaceId: string, userId: string, role: Role | null): { ok: true } | { error: string } {
    const current = this.sql
      .exec<{ role: Role }>("SELECT role FROM membership WHERE workspace_id = ? AND user_id = ?", workspaceId, userId)
      .toArray()[0];
    if (!current) return { error: "member not found" };
    if (current.role === "owner" && role !== "owner") {
      const owners = this.sql
        .exec<{ n: number }>("SELECT count(*) AS n FROM membership WHERE workspace_id = ? AND role = 'owner'", workspaceId)
        .toArray()[0]!.n;
      if (owners <= 1) return { error: "a workspace needs at least one owner" };
    }
    if (role === null) this.sql.exec("DELETE FROM membership WHERE workspace_id = ? AND user_id = ?", workspaceId, userId);
    else this.sql.exec("UPDATE membership SET role = ? WHERE workspace_id = ? AND user_id = ?", role, workspaceId, userId);
    return { ok: true };
  }

  // ---- internals ----

  private memberships(userId: string): Membership[] {
    return this.sql
      .exec<{ workspace_id: string; workspace_name: string; role: Role }>(
        "SELECT workspace_id, workspace_name, role FROM membership WHERE user_id = ? ORDER BY workspace_name",
        userId,
      )
      .toArray()
      .map((m) => ({ workspaceId: m.workspace_id, workspaceName: m.workspace_name, role: m.role }));
  }

  private async createSession(userId: string, stage: "full" | "mfa"): Promise<string> {
    const token = randomHex(32);
    const now = Date.now();
    this.sql.exec("DELETE FROM session WHERE expires_at < ?", now);
    this.sql.exec(
      "INSERT INTO session (hash, user_id, stage, expires_at, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      await sha256Hex(token), userId, stage, now + (stage === "full" ? SESSION_TTL_MS : MFA_SESSION_TTL_MS), now, now,
    );
    return token;
  }

  private async checkTotp(userId: string, code: string): Promise<boolean> {
    const user = this.userRow(userId);
    if (!user?.totp_secret) return false;
    const now = Date.now();
    if (user.locked_until && user.locked_until > now) return false;
    const step = await verifyTotp(user.totp_secret, code, now, user.totp_last_step);
    if (step === null) {
      this.recordFailure(user, now);
      return false;
    }
    this.sql.exec("UPDATE user SET totp_last_step = ?, failures = 0, locked_until = NULL WHERE id = ?", step, userId);
    return true;
  }

  private recordFailure(user: UserRow, now: number): void {
    const failures = user.failures + 1;
    if (failures >= MAX_FAILURES) this.sql.exec("UPDATE user SET failures = 0, locked_until = ? WHERE id = ?", now + LOCK_MS, user.id);
    else this.sql.exec("UPDATE user SET failures = ? WHERE id = ?", failures, user.id);
  }

  private insertPasskey(userId: string, p: Omit<StoredPasskey, "userId"> & { label: string }, now: number): void {
    this.sql.exec(
      "INSERT INTO passkey (id, user_id, public_key, algorithm, transports, counter, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      p.id, userId, p.publicKey, p.algorithm, JSON.stringify(p.transports), p.counter, p.label, now,
    );
  }

  private userRow(id: string): UserRow | undefined {
    return this.sql.exec<UserRow>("SELECT * FROM user WHERE id = ?", id).toArray()[0];
  }

  private sessionRow(hash: string) {
    return this.sql
      .exec<{ user_id: string; stage: "full" | "mfa"; expires_at: number; seen_at: number }>("SELECT * FROM session WHERE hash = ?", hash)
      .toArray()[0];
  }

  private inviteRow(hash: string) {
    const row = this.sql
      .exec<{ email: string; workspace_id: string; workspace_name: string; role: Role; expires_at: number }>("SELECT * FROM invite WHERE hash = ?", hash)
      .toArray()[0];
    return row && row.expires_at > Date.now() ? row : undefined;
  }
}

type UserRow = {
  id: string;
  email: string;
  name: string;
  totp_secret: string | null;
  totp_pending: string | null;
  totp_last_step: number | null;
  failures: number;
  locked_until: number | null;
  created_at: number;
};

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
