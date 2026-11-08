/** Whether `value` is one of `list`, so a string from a URL or storage can be used as that union. */
export function isOneOf<const T extends string | number>(list: readonly T[], value: unknown): value is T {
  return list.some((item) => item === value);
}
