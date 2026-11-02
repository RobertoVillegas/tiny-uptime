import type { ApiError, ErrorCode } from "@tiny-uptime/contracts";
import type { ErrorData } from "@tiny-uptime/core";
import type { Wire } from "../../runtime/wire";

const BY_TAG: Record<ErrorData["_tag"], { status: number; code: ErrorCode }> = {
  Invalid: { status: 400, code: "invalid_input" },
  Unauthorized: { status: 401, code: "unauthorized" },
  Forbidden: { status: 403, code: "forbidden" },
  NotFound: { status: 404, code: "not_found" },
  Conflict: { status: 409, code: "conflict" },
  TooManyAttempts: { status: 429, code: "too_many_attempts" },
  DeliveryFailed: { status: 502, code: "delivery_failed" },
};

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** The single place an error becomes an HTTP answer. */
export function fail(error: ErrorData): Response {
  const { status, code } = BY_TAG[error._tag];
  const body: ApiError = { error: error.message, code, ...(error.field ? { field: error.field } : {}) };
  return json(status, body);
}

export function failWith(status: number, code: ErrorCode, message: string): Response {
  return json(status, { error: message, code } satisfies ApiError);
}

/** Answers a use case result: the presented value on success, the mapped error otherwise. */
export function reply<T>(wire: Wire<T>, present: (value: T) => unknown = (v) => v, status = 200): Response {
  if (wire.status === "error") return fail(wire.error);
  return status === 204 ? noContent() : json(status, present(wire.value));
}

/** Answers a rejected request body: either a ready response (size, JSON) or a validation error. */
export function rejected(reason: Response | ErrorData): Response {
  return reason instanceof Response ? reason : fail(reason);
}
