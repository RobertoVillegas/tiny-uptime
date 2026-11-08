// Writes src/styles/tokens.css from src/tokens.ts. With --check, fails instead when the file is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { COLORS, RADIUS, TEXT, tokensCss } from "../src/tokens.ts";

const out = new URL("../src/styles/tokens.css", import.meta.url);

const theme = [
  ...Object.keys(COLORS.light)
    .filter((name) => !name.startsWith("shadow-"))
    .map((name) => `  --color-${name}: var(--${name});`),
  "  --shadow-raised: var(--shadow-raised);",
  ...Object.entries(TEXT).map(([name, size]) => `  --text-${name}: ${size};`),
  ...Object.entries(RADIUS).map(([name, size]) => `  --radius-${name}: ${size};`),
];

const css = `/* Generated from ../tokens.ts by \`pnpm --filter @tiny-uptime/ui tokens\`. Edit that file instead. */
${tokensCss()}

@theme inline {
${theme.join("\n")}
}
`;

if (process.argv.includes("--check")) {
  if (readFileSync(out, "utf8") !== css) {
    console.error("src/styles/tokens.css is stale: run `pnpm --filter @tiny-uptime/ui tokens`.");
    process.exit(1);
  }
} else {
  writeFileSync(out, css);
}
