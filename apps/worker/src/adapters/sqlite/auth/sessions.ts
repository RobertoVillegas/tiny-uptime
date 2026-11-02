import type { Challenge, ChallengeRepository, Session, SessionRepository } from "@tiny-uptime/core";
import { first } from "../rows";

type SessionRow = { hash: string; user_id: string; stage: Session["stage"]; expires_at: number; created_at: number; seen_at: number };
type ChallengeRow = { id: string; value: string; purpose: Challenge["purpose"]; subject: string | null; expires_at: number };

export class SqliteSessions implements SessionRepository {
  constructor(private readonly sql: SqlStorage) {}

  get(hash: string): Session | null {
    const row = first(this.sql.exec<SessionRow>("SELECT * FROM session WHERE hash = ?", hash));
    return (
      row && {
        hash: row.hash,
        userId: row.user_id,
        stage: row.stage,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        seenAt: row.seen_at,
      }
    );
  }

  insert(s: Session): void {
    this.sql.exec(
      "INSERT INTO session (hash, user_id, stage, expires_at, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      s.hash,
      s.userId,
      s.stage,
      s.expiresAt,
      s.createdAt,
      s.seenAt,
    );
  }

  touch(hash: string, at: number): void {
    this.sql.exec("UPDATE session SET seen_at = ? WHERE hash = ?", at, hash);
  }

  delete(hash: string): void {
    this.sql.exec("DELETE FROM session WHERE hash = ?", hash);
  }

  deleteOthers(userId: string, keepHash: string): void {
    this.sql.exec("DELETE FROM session WHERE user_id = ? AND hash <> ?", userId, keepHash);
  }

  purgeExpired(now: number): void {
    this.sql.exec("DELETE FROM session WHERE expires_at < ?", now);
  }
}

export class SqliteChallenges implements ChallengeRepository {
  constructor(private readonly sql: SqlStorage) {}

  insert(c: Challenge): void {
    this.sql.exec(
      "INSERT INTO challenge (id, value, purpose, subject, expires_at) VALUES (?, ?, ?, ?, ?)",
      c.id,
      c.value,
      c.purpose,
      c.subject,
      c.expiresAt,
    );
  }

  take(id: string): Challenge | null {
    const row = first(this.sql.exec<ChallengeRow>("SELECT * FROM challenge WHERE id = ?", id));
    if (!row) return null;
    this.sql.exec("DELETE FROM challenge WHERE id = ?", id);
    return { id: row.id, value: row.value, purpose: row.purpose, subject: row.subject, expiresAt: row.expires_at };
  }

  purgeExpired(now: number): void {
    this.sql.exec("DELETE FROM challenge WHERE expires_at < ?", now);
  }
}
