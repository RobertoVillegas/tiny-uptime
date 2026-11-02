import type { Result, SerializedResult } from "better-result";
import { toErrorData, type AppError, type ErrorData } from "@tiny-uptime/core";

/** A use case result as it crosses RPC: plain data, errors reduced to their tag and message. */
export type Wire<T> = SerializedResult<T, ErrorData>;

export function toWire<T>(result: Result<T, AppError>): Wire<T> {
  return result.isOk() ? { status: "ok", value: result.value } : { status: "error", error: toErrorData(result.error) };
}

export function okWire<T>(value: T): Wire<T> {
  return { status: "ok", value };
}
