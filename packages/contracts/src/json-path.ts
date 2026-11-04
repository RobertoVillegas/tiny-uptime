/** One step into a JSON document: an object key or an array index. */
export type JsonStep = string | number;

/**
 * The steps of a path such as `$.data.items[0].status` or `$["odd key"]` (the leading `$` is
 * optional), or an error message. Parsed by hand, never evaluated or turned into a regex, so a
 * monitor's settings cannot make a check slow or run code.
 */
export function parseJsonPath(path: string): JsonStep[] | string {
  const steps: JsonStep[] = [];
  const key = (from: number) => {
    let j = from;
    while (j < path.length && path[j] !== "." && path[j] !== "[" && path[j] !== "]") j++;
    return j;
  };
  let i = path.startsWith("$") ? 1 : 0;
  if (i === 0 && path.length && path[0] !== "[" && path[0] !== ".") {
    i = key(0);
    steps.push(path.slice(0, i));
  }
  while (i < path.length) {
    if (path[i] === ".") {
      const j = key(i + 1);
      if (j === i + 1) return `has an empty key at position ${i + 1}`;
      steps.push(path.slice(i + 1, j));
      i = j;
    } else if (path[i] === "[") {
      const quote = path[i + 1];
      if (quote === '"' || quote === "'") {
        const end = path.indexOf(`${quote}]`, i + 2);
        if (end < 0) return `has an unclosed quoted key at position ${i}`;
        steps.push(path.slice(i + 2, end));
        i = end + 2;
      } else {
        const end = path.indexOf("]", i);
        const n = end < 0 ? "" : path.slice(i + 1, end);
        if (!/^\d{1,6}$/.test(n)) return `needs an array index at position ${i}`;
        steps.push(Number(n));
        i = end + 1;
      }
    } else return `has an unexpected "${path[i]}" at position ${i}`;
  }
  return steps.length ? steps : "must name a field";
}
