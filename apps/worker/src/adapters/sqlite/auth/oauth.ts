import type {
  AuthorizationCode,
  OAuthClient,
  OAuthClientRepository,
  OAuthGrant,
  OAuthGrantRepository,
  OAuthToken,
} from "@tiny-uptime/core";
import { first, json } from "../rows";

type ClientRow = { id: string; name: string; redirect_uris: string; created_at: number };
type GrantRow = {
  id: string;
  client_id: string;
  user_id: string;
  workspace_id: string;
  scopes: string;
  resource: string;
  created_at: number;
  last_used_at: number | null;
};
type CodeRow = { hash: string; grant_id: string; client_id: string; redirect_uri: string; code_challenge: string; expires_at: number };
type TokenRow = { hash: string; grant_id: string; kind: OAuthToken["kind"]; expires_at: number; used_at: number | null };

export class SqliteOAuthClients implements OAuthClientRepository {
  constructor(private readonly sql: SqlStorage) {}

  insert(c: OAuthClient): void {
    this.sql.exec(
      "INSERT INTO oauth_client (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)",
      c.id,
      c.name,
      JSON.stringify(c.redirectUris),
      c.createdAt,
    );
  }

  get(id: string): OAuthClient | null {
    const row = first(this.sql.exec<ClientRow>("SELECT * FROM oauth_client WHERE id = ?", id));
    return row && { id: row.id, name: row.name, redirectUris: json<string[]>(row.redirect_uris), createdAt: row.created_at };
  }

  purgeUnused(before: number): void {
    this.sql.exec(
      "DELETE FROM oauth_client WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM oauth_grant g WHERE g.client_id = oauth_client.id)",
      before,
    );
  }
}

export class SqliteOAuthGrants implements OAuthGrantRepository {
  constructor(private readonly sql: SqlStorage) {}

  insert(g: OAuthGrant): void {
    this.sql.exec(
      "INSERT INTO oauth_grant (id, client_id, user_id, workspace_id, scopes, resource, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      g.id,
      g.clientId,
      g.userId,
      g.workspaceId,
      g.scopes.join(" "),
      g.resource,
      g.createdAt,
      g.lastUsedAt,
    );
  }

  get(id: string): OAuthGrant | null {
    const row = first(this.sql.exec<GrantRow>("SELECT * FROM oauth_grant WHERE id = ?", id));
    return row && toGrant(row);
  }

  forUser(userId: string): (OAuthGrant & { clientName: string })[] {
    return this.sql
      .exec<GrantRow & { client_name: string }>(
        `SELECT g.*, c.name AS client_name FROM oauth_grant g JOIN oauth_client c ON c.id = g.client_id
         WHERE g.user_id = ? AND EXISTS (SELECT 1 FROM oauth_token t WHERE t.grant_id = g.id)
         ORDER BY g.created_at DESC`,
        userId,
      )
      .toArray()
      .map((row) => ({ ...toGrant(row), clientName: row.client_name }));
  }

  touch(id: string, at: number): void {
    this.sql.exec("UPDATE oauth_grant SET last_used_at = ? WHERE id = ?", at, id);
  }

  delete(id: string): void {
    this.sql.exec("DELETE FROM oauth_token WHERE grant_id = ?", id);
    this.sql.exec("DELETE FROM oauth_code WHERE grant_id = ?", id);
    this.sql.exec("DELETE FROM oauth_grant WHERE id = ?", id);
  }

  insertCode(c: AuthorizationCode): void {
    this.sql.exec(
      "INSERT INTO oauth_code (hash, grant_id, client_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      c.hash,
      c.grantId,
      c.clientId,
      c.redirectUri,
      c.codeChallenge,
      c.expiresAt,
    );
  }

  takeCode(hash: string): AuthorizationCode | null {
    const row = first(this.sql.exec<CodeRow>("SELECT * FROM oauth_code WHERE hash = ?", hash));
    if (!row) return null;
    this.sql.exec("DELETE FROM oauth_code WHERE hash = ?", hash);
    return {
      hash: row.hash,
      grantId: row.grant_id,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      expiresAt: row.expires_at,
    };
  }

  insertToken(t: OAuthToken): void {
    this.sql.exec(
      "INSERT INTO oauth_token (hash, grant_id, kind, expires_at, used_at) VALUES (?, ?, ?, ?, ?)",
      t.hash,
      t.grantId,
      t.kind,
      t.expiresAt,
      t.usedAt,
    );
  }

  token(hash: string): OAuthToken | null {
    const row = first(this.sql.exec<TokenRow>("SELECT * FROM oauth_token WHERE hash = ?", hash));
    return row && { hash: row.hash, grantId: row.grant_id, kind: row.kind, expiresAt: row.expires_at, usedAt: row.used_at };
  }

  markUsed(hash: string, at: number): void {
    this.sql.exec("UPDATE oauth_token SET used_at = ? WHERE hash = ?", at, hash);
  }

  /** Drops expired codes and tokens, then grants left with neither (abandoned or long unused). */
  purgeExpired(now: number): void {
    this.sql.exec("DELETE FROM oauth_code WHERE expires_at < ?", now);
    this.sql.exec("DELETE FROM oauth_token WHERE expires_at < ?", now);
    this.sql.exec(
      `DELETE FROM oauth_grant WHERE created_at < ?
       AND NOT EXISTS (SELECT 1 FROM oauth_token t WHERE t.grant_id = oauth_grant.id)
       AND NOT EXISTS (SELECT 1 FROM oauth_code c WHERE c.grant_id = oauth_grant.id)`,
      now - 60_000,
    );
  }
}

function toGrant(row: GrantRow): OAuthGrant {
  return {
    id: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    scopes: row.scopes.split(" ") as OAuthGrant["scopes"],
    resource: row.resource,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}
