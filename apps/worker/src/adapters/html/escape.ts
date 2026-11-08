/** Escapes text for HTML content and double- or single-quoted attributes. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
