import type { User, UserRepository } from "@tiny-uptime/core";
import { first } from "../rows";

type Row = {
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

export class SqliteUsers implements UserRepository {
  constructor(private readonly sql: SqlStorage) {}

  get(id: string): User | null {
    const row = first(this.sql.exec<Row>("SELECT * FROM user WHERE id = ?", id));
    return row && toUser(row);
  }

  byEmail(email: string): User | null {
    const row = first(this.sql.exec<Row>("SELECT * FROM user WHERE email = ?", email));
    return row && toUser(row);
  }

  insert(u: User): void {
    this.sql.exec(
      `INSERT INTO user (id, email, name, totp_secret, totp_pending, totp_last_step, failures, locked_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      u.id,
      u.email,
      u.name,
      u.totpSecret,
      u.totpPending,
      u.totpLastStep,
      u.failures,
      u.lockedUntil,
      u.createdAt,
    );
  }

  save(u: User): void {
    this.sql.exec(
      "UPDATE user SET email = ?, name = ?, totp_secret = ?, totp_pending = ?, totp_last_step = ?, failures = ?, locked_until = ? WHERE id = ?",
      u.email,
      u.name,
      u.totpSecret,
      u.totpPending,
      u.totpLastStep,
      u.failures,
      u.lockedUntil,
      u.id,
    );
  }
}

function toUser(row: Row): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    totpSecret: row.totp_secret,
    totpPending: row.totp_pending,
    totpLastStep: row.totp_last_step,
    failures: row.failures,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
  };
}
