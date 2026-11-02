import type { Invite, InviteRepository, MembershipRepository, RecoveryCodeRepository } from "@tiny-uptime/core";
import type { Membership, Role } from "@tiny-uptime/contracts";
import { first } from "../rows";

type MembershipRow = { workspace_id: string; workspace_name: string; role: Role };
type InviteRow = {
  hash: string;
  email: string;
  workspace_id: string;
  workspace_name: string;
  role: Role;
  expires_at: number;
  created_at: number;
};

export class SqliteMemberships implements MembershipRepository {
  constructor(private readonly sql: SqlStorage) {}

  forUser(userId: string): Membership[] {
    return this.sql
      .exec<MembershipRow>("SELECT workspace_id, workspace_name, role FROM membership WHERE user_id = ? ORDER BY workspace_name", userId)
      .toArray()
      .map(toMembership);
  }

  forWorkspace(workspaceId: string) {
    return this.sql
      .exec<{ id: string; email: string; name: string; role: Role }>(
        "SELECT u.id, u.email, u.name, m.role FROM membership m JOIN user u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.email",
        workspaceId,
      )
      .toArray()
      .map((m) => ({ userId: m.id, email: m.email, name: m.name, role: m.role }));
  }

  get(userId: string, workspaceId: string): Membership | null {
    const row = first(
      this.sql.exec<MembershipRow>(
        "SELECT workspace_id, workspace_name, role FROM membership WHERE user_id = ? AND workspace_id = ?",
        userId,
        workspaceId,
      ),
    );
    return row && toMembership(row);
  }

  upsert(userId: string, m: Membership): void {
    this.sql.exec(
      `INSERT INTO membership (user_id, workspace_id, workspace_name, role) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, workspace_id) DO UPDATE SET role = excluded.role, workspace_name = excluded.workspace_name`,
      userId,
      m.workspaceId,
      m.workspaceName,
      m.role,
    );
  }

  setRole(userId: string, workspaceId: string, role: Role): void {
    this.sql.exec("UPDATE membership SET role = ? WHERE user_id = ? AND workspace_id = ?", role, userId, workspaceId);
  }

  delete(userId: string, workspaceId: string): void {
    this.sql.exec("DELETE FROM membership WHERE user_id = ? AND workspace_id = ?", userId, workspaceId);
  }

  countOwners(workspaceId: string): number {
    return first(
      this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM membership WHERE workspace_id = ? AND role = 'owner'", workspaceId),
    )!.n;
  }
}

export class SqliteInvites implements InviteRepository {
  constructor(private readonly sql: SqlStorage) {}

  insert(i: Invite): void {
    this.sql.exec(
      "INSERT INTO invite (hash, email, workspace_id, workspace_name, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      i.hash,
      i.email,
      i.workspaceId,
      i.workspaceName,
      i.role,
      i.expiresAt,
      i.createdAt,
    );
  }

  get(hash: string): Invite | null {
    const row = first(this.sql.exec<InviteRow>("SELECT * FROM invite WHERE hash = ?", hash));
    return row && toInvite(row);
  }

  delete(hash: string): void {
    this.sql.exec("DELETE FROM invite WHERE hash = ?", hash);
  }

  pending(workspaceId: string, now: number): Invite[] {
    return this.sql
      .exec<InviteRow>("SELECT * FROM invite WHERE workspace_id = ? AND expires_at > ? ORDER BY created_at", workspaceId, now)
      .toArray()
      .map(toInvite);
  }
}

export class SqliteRecoveryCodes implements RecoveryCodeRepository {
  constructor(private readonly sql: SqlStorage) {}

  replace(userId: string, hashes: string[]): void {
    this.sql.exec("DELETE FROM recovery_code WHERE user_id = ?", userId);
    for (const hash of hashes) this.sql.exec("INSERT INTO recovery_code (user_id, hash) VALUES (?, ?)", userId, hash);
  }

  consume(userId: string, hash: string): boolean {
    return this.sql.exec("DELETE FROM recovery_code WHERE user_id = ? AND hash = ?", userId, hash).rowsWritten > 0;
  }

  count(userId: string): number {
    return first(this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM recovery_code WHERE user_id = ?", userId))!.n;
  }
}

function toMembership(row: MembershipRow): Membership {
  return { workspaceId: row.workspace_id, workspaceName: row.workspace_name, role: row.role };
}

function toInvite(row: InviteRow): Invite {
  return {
    hash: row.hash,
    email: row.email,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}
