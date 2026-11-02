/**
 * Cuts `text` to at most `max` UTF-16 code units (what JavaScript and most chat APIs count), ending with "…" when
 * it was cut. Whole code points are kept, so an emoji is never split in half.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}

/** Cuts `text` to at most `max` bytes of UTF-8, ending with "…" (3 bytes) when it was cut. */
export function clipBytes(text: string, max: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= max) return text;
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const size = encoder.encode(ch).length;
    if (bytes + size > max - 3) break;
    out += ch;
    bytes += size;
  }
  return `${out}…`;
}
