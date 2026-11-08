// Fails when UI code steps around the design tokens in packages/ui/src/tokens.ts: a font size,
// color or radius typed by hand, a color literal outside the tokens, or the plain `cn` that does
// not know the token scale. Arbitrary values for layout (grid templates, calc, transitions) are fine.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", "dist", ".wrangler", ".turbo", "test-results", "playwright-report"]);

/** Where each rule applies, and what it says when broken. */
const rules: { dirs: string[]; ext: RegExp; pattern: RegExp; message: string; except?: string[] }[] = [
  {
    dirs: ["apps/panel/src", "packages/ui/src"],
    ext: /\.tsx?$/,
    pattern: /\btext-\[(?:\d|\.)[^\]]*\]/g,
    message: "font size typed by hand; use the type scale (text-caption, text-small, text-sm…) or add a step to tokens.ts",
  },
  {
    dirs: ["apps/panel/src", "packages/ui/src"],
    ext: /\.tsx?$/,
    pattern: /\b(?:text|bg|border|ring|outline|fill|stroke|shadow|from|to|via)-\[(?:#|rgb|hsl|oklch|color-mix)[^\]]*\]/g,
    message: "color typed by hand; name it in tokens.ts",
  },
  {
    dirs: ["apps/panel/src", "packages/ui/src"],
    ext: /\.tsx?$/,
    pattern: /\brounded(?:-[a-z]{1,2})?-\[\d[^\]]*\]/g,
    message: "radius typed by hand; use rounded-inner, rounded-control, rounded-card or Tailwind's scale",
  },
  {
    dirs: ["apps/panel/src", "packages/ui/src", "apps/worker/src/adapters/html"],
    ext: /\.(tsx?|css)$/,
    pattern: /\b(?:oklch|oklab|rgba?|hsla?)\(|#[0-9a-f]{3,8}\b(?=[;\s"'`)])/gi,
    message: "color literal outside the tokens; add it to packages/ui/src/tokens.ts",
    // The badge uses shields.io's palette on purpose, so it matches the other badges in a README.
    except: ["packages/ui/src/tokens.ts", "packages/ui/src/styles/tokens.css", "apps/worker/src/adapters/html/status-badge.ts"],
  },
  {
    dirs: ["apps/panel/src", "packages/ui/src"],
    ext: /\.tsx?$/,
    pattern: /from "cn"/g,
    message: "plain cn drops token classes like text-small; import cn from @tiny-uptime/ui/cn",
    except: ["packages/ui/src/cn.ts"],
  },
];

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

const problems: string[] = [];
for (const rule of rules) {
  for (const dir of rule.dirs) {
    for (const file of files(join(root, dir))) {
      const path = relative(root, file);
      if (!rule.ext.test(path) || rule.except?.includes(path)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const match of line.matchAll(rule.pattern)) problems.push(`${path}:${i + 1}: ${match[0]}: ${rule.message}`);
        });
    }
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} design token violation(s).`);
  process.exit(1);
}
console.log("Design tokens ok.");
