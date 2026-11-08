/** TanStack Form collects Standard Schema issues per field; show the first as text. */
export function firstError(errors: readonly unknown[]): string | undefined {
  const first = errors[0];
  if (!first) return undefined;
  if (typeof first === "string") return first;
  if (typeof first === "object" && "message" in first) return capitalize(String((first as { message: unknown }).message));
  return undefined;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "url: must be an http or https URL", as validation and the API word it, reads "Must be an http or https URL" under its field. */
export function fieldMessage(field: string, message: string): string {
  return capitalize(message.startsWith(`${field}: `) ? message.slice(field.length + 2) : message);
}
