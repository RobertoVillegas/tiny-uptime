import { ApiError, createClient } from "@tiny-uptime/client";

const STORAGE_KEY = "tiny-uptime.workspace";
let workspaceId: string | null = readStoredWorkspace();

function readStoredWorkspace(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The workspace the panel acts on; remembered per browser. */
export function currentWorkspaceId(): string | null {
  return workspaceId;
}

export function setCurrentWorkspace(id: string): void {
  workspaceId = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode: the choice lasts for this tab only.
  }
}

export const api = createClient({ baseUrl: "", workspaceId: () => workspaceId });

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** A sentence a person can act on, for toasts and inline errors. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return capitalize(error.message);
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "The passkey prompt was closed or timed out. Try again when you are ready.";
  return "Something unexpected happened. Try again, and reload the page if it keeps failing.";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export { ApiError };
