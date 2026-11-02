const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** Random lowercase base32 id; 12 characters carry 60 bits. */
export function newId(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte & 31];
  return out;
}

export function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

const WORKSPACE_ID = /^[a-z2-7]{12}$/;

export function isWorkspaceId(value: string): boolean {
  return WORKSPACE_ID.test(value);
}

/**
 * API keys and heartbeat tokens name their workspace, so a request reaches the right
 * Durable Object without a directory lookup. The workspace checks the secret part.
 */
export function newApiKey(workspaceId: string): string {
  return `tu_${workspaceId}_${randomHex(24)}`;
}

export function parseApiKey(key: string): { workspaceId: string } | null {
  const match = /^tu_([a-z2-7]{12})_[0-9a-f]{48}$/.exec(key);
  return match ? { workspaceId: match[1]! } : null;
}

export function newHeartbeatToken(workspaceId: string): string {
  return `${workspaceId}_${randomHex(16)}`;
}

export function parseHeartbeatToken(token: string): { workspaceId: string } | null {
  const match = /^([a-z2-7]{12})_[0-9a-f]{32}$/.exec(token);
  return match ? { workspaceId: match[1]! } : null;
}
