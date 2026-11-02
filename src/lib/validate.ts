/** Thrown for bad input; the API turns it into a 400 naming the field. */
export class InvalidInput extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
  }
}

export type Input = Record<string, unknown>;

export function asObject(value: unknown, field = "body"): Input {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidInput(field, "must be an object");
  return value as Input;
}

export function str(input: Input, field: string, opts: { min?: number; max: number; pattern?: RegExp }): string;
export function str(input: Input, field: string, opts: { min?: number; max: number; pattern?: RegExp; optional: true }): string | undefined;
export function str(
  input: Input,
  field: string,
  opts: { min?: number; max: number; pattern?: RegExp; optional?: boolean },
): string | undefined {
  const value = input[field];
  if (value === undefined && opts.optional) return undefined;
  if (typeof value !== "string") throw new InvalidInput(field, "must be a string");
  const trimmed = value.trim();
  if (trimmed.length < (opts.min ?? 1)) throw new InvalidInput(field, `must have at least ${opts.min ?? 1} characters`);
  if (trimmed.length > opts.max) throw new InvalidInput(field, `must have at most ${opts.max} characters`);
  if (opts.pattern && !opts.pattern.test(trimmed)) throw new InvalidInput(field, "has an invalid format");
  return trimmed;
}

export function int(input: Input, field: string, opts: { min: number; max: number; fallback?: number }): number {
  const value = input[field];
  if (value === undefined && opts.fallback !== undefined) return opts.fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new InvalidInput(field, "must be an integer");
  if (value < opts.min || value > opts.max) throw new InvalidInput(field, `must be between ${opts.min} and ${opts.max}`);
  return value;
}

export function bool(input: Input, field: string, fallback: boolean): boolean {
  const value = input[field];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new InvalidInput(field, "must be true or false");
  return value;
}

export function oneOf<T extends string>(input: Input, field: string, options: readonly T[], fallback?: T): T {
  const value = input[field];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new InvalidInput(field, `must be one of ${options.join(", ")}`);
  }
  return value as T;
}

export function httpUrl(input: Input, field: string): string {
  const value = str(input, field, { max: 2048 });
  const url = URL.parse(value);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) throw new InvalidInput(field, "must be an http or https URL");
  return url.toString();
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

export function hostname(input: Input, field: string): string {
  return str(input, field, { max: 253, pattern: HOSTNAME }).toLowerCase();
}
