import type { ApiError as ApiErrorBody, ErrorCode } from "@tiny-uptime/contracts";

/** A failed API call, carrying the server's stable code and, for invalid input, the field. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "network_error",
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export type Transport = {
  /** Base URL of the tiny-uptime Worker; empty for same-origin (the panel). */
  baseUrl: string;
  /** Workspace the REST calls act on, sent as `x-workspace-id` for session-authenticated clients. */
  workspaceId: () => string | null;
  /** Extra headers, e.g. an API key for clients that do not use the session cookie. */
  headers?: () => Record<string, string>;
};

export async function call<T>(t: Transport, method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...t.headers?.() };
  const workspace = t.workspaceId();
  if (workspace) headers["x-workspace-id"] = workspace;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${t.baseUrl}${path}`, {
      method,
      headers,
      credentials: "same-origin",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "network_error", "Could not reach tiny-uptime. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const error = data as Partial<ApiErrorBody> | null;
    throw new ApiError(res.status, error?.code ?? "invalid_input", error?.error ?? `Request failed with HTTP ${res.status}`, error?.field);
  }
  return data as T;
}
