import type { OAuthScope, Role } from "@tiny-uptime/contracts";

export type OAuthClient = { id: string; name: string; redirectUris: string[]; createdAt: number };

/** One user's consent for one client on one workspace. Tokens hang off it; revoking it ends them all. */
export type OAuthGrant = {
  id: string;
  clientId: string;
  userId: string;
  workspaceId: string;
  scopes: OAuthScope[];
  /** The resource (RFC 8707) the tokens are for: this server's MCP endpoint. */
  resource: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type AuthorizationCode = {
  hash: string;
  grantId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
};

export type OAuthToken = { hash: string; grantId: string; kind: "access" | "refresh"; expiresAt: number; usedAt: number | null };

const MINUTE = 60_000;
export const OAUTH_POLICY = {
  codeTtlMs: MINUTE,
  accessTtlMs: 60 * MINUTE,
  refreshTtlMs: 30 * 24 * 60 * MINUTE,
  /** How often a grant's last use is written, at most. */
  touchMs: 5 * MINUTE,
  /** A registered client that never got a grant is forgotten after this. */
  unusedClientTtlMs: 24 * 60 * MINUTE,
} as const;

/**
 * Redirect URIs a public client may register (OAuth 2.1 and RFC 8252): https anywhere, http only on a
 * loopback address, or an app's private-use scheme with a dot in it (com.example.app:/callback).
 */
export function redirectUriProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "is not a URL";
  }
  if (url.hash) return "must not have a fragment";
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:") return isLoopback(url.hostname) ? null : "must use https, except on localhost";
  if (/^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/i.test(url.protocol)) return null;
  return "must use https, a loopback address or an app scheme like com.example.app:";
}

/** Exact match, except that a loopback redirect may use any port (RFC 8252 §7.3). */
export function redirectMatches(registered: readonly string[], given: string): boolean {
  if (registered.includes(given)) return true;
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || !isLoopback(url.hostname)) return false;
  return registered.some((r) => {
    const reg = new URL(r);
    return reg.protocol === "http:" && reg.hostname === url.hostname && reg.pathname === url.pathname && reg.search === url.search;
  });
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Scopes asked for, defaulting to everything; null when one is unknown. */
export function parseScopes(raw: string | null | undefined): OAuthScope[] | null {
  const words = (raw ?? "").split(" ").filter(Boolean);
  if (!words.length) return ["mcp:read", "mcp:write"];
  const known = ["mcp:read", "mcp:write"] as const;
  if (!words.every((w) => (known as readonly string[]).includes(w))) return null;
  return known.filter((s) => words.includes(s));
}

/** The role a token acts with: the member's role, lowered to viewer when the token cannot write. */
export function tokenRole(role: Role, scopes: readonly OAuthScope[]): Role {
  return scopes.includes("mcp:write") ? role : "viewer";
}
