import { Result } from "better-result";
import { validate, type ApiError } from "@tiny-uptime/contracts";
import type { ErrorData } from "@tiny-uptime/core";
import type * as v from "valibot";
import { failWith } from "./respond";

const MAX_BODY_BYTES = 64 * 1024;

/** Reads a JSON body, bounded in size, and validates it against a schema. */
export async function readBody<S extends v.GenericSchema>(request: Request, schema: S): Promise<Result<v.InferOutput<S>, Response | ErrorData>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return Result.err(failWith(413, "invalid_input", "body too large"));
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Result.err(failWith(413, "invalid_input", "body too large"));
  let value: unknown = {};
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      return Result.err(failWith(400, "invalid_input", "body must be JSON"));
    }
  }
  const parsed = validate(schema, value);
  return parsed.ok ? Result.ok(parsed.value) : Result.err({ _tag: "Invalid", message: parsed.message, field: parsed.field });
}

export function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return request.headers.get("x-api-key");
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export type { ApiError };
