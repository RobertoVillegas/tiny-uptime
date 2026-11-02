import { TaggedError } from "better-result";

/** Expected failures, returned as values. Anything thrown instead is a bug. */
export class Invalid extends TaggedError("Invalid")<{ field: string; message: string }> {}
export class NotFound extends TaggedError("NotFound")<{ message: string }> {}
export class Unauthorized extends TaggedError("Unauthorized")<{ message: string }> {}
export class Forbidden extends TaggedError("Forbidden")<{ message: string }> {}
export class Conflict extends TaggedError("Conflict")<{ message: string }> {}
export class TooManyAttempts extends TaggedError("TooManyAttempts")<{ message: string }> {}
export class DeliveryFailed extends TaggedError("DeliveryFailed")<{ message: string }> {}

export type AppError = Invalid | NotFound | Unauthorized | Forbidden | Conflict | TooManyAttempts | DeliveryFailed;

/** The plain-data form an error takes across RPC and HTTP. */
export type ErrorData = { _tag: AppError["_tag"]; message: string; field?: string };

export function toErrorData(error: AppError): ErrorData {
  return Invalid.is(error)
    ? { _tag: error._tag, message: error.message, field: error.field }
    : { _tag: error._tag, message: error.message };
}
