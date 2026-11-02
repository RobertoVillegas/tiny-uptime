import * as v from "valibot";

/** Every error response has this shape; `code` is stable for clients, `error` is for people. */
export type ApiError = { error: string; code: ErrorCode; field?: string };

export type ErrorCode = "invalid_input" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "too_many_attempts" | "delivery_failed";

/** The first issue of a failed validation, as the field it names and a message. */
export function describeIssues(issues: readonly v.BaseIssue<unknown>[]): { field: string; message: string } {
  const issue = issues[0];
  const field = issue?.path?.map((p) => String(p.key)).join(".") || "body";
  return { field, message: `${field}: ${issue?.message ?? "is invalid"}` };
}

export type Validation<T> = { ok: true; value: T } | { ok: false; field: string; message: string };

/** Runs a schema and reports the first problem by field, the way the API answers. */
export function validate<S extends v.GenericSchema>(schema: S, value: unknown): Validation<v.InferOutput<S>> {
  const result = v.safeParse(schema, value);
  return result.success ? { ok: true, value: result.output } : { ok: false, ...describeIssues(result.issues) };
}
