// Fails when an import crosses a layer it should not. The architecture in README.md, enforced:
// dependencies point inward, only apps/worker knows Cloudflare, and every package import is declared.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { parseSync } from "oxc-parser";

const root = resolve(import.meta.dirname, "..");

type Rule = {
  /** Path prefix (relative to the repo) the rule applies to; the longest matching prefix wins. */
  layer: string;
  /** Other layers this one may import. */
  mayImport: string[];
  /** Whether `cloudflare:*` modules are allowed. */
  cloudflare?: boolean;
};

const rules: Rule[] = [
  { layer: "packages/contracts/src", mayImport: [] },
  { layer: "packages/core/src/domain", mayImport: ["packages/contracts/src"] },
  { layer: "packages/core/src/errors.ts", mayImport: [] },
  { layer: "packages/core/src/ports", mayImport: ["packages/core/src/domain", "packages/core/src/errors.ts", "packages/contracts/src"] },
  {
    layer: "packages/core/src/application",
    mayImport: ["packages/core/src/domain", "packages/core/src/ports", "packages/core/src/errors.ts", "packages/contracts/src"],
  },
  { layer: "packages/core/src/index.ts", mayImport: ["packages/core/src"] },
  { layer: "packages/core/test", mayImport: ["packages/core/src", "packages/contracts/src"] },
  { layer: "packages/ui/src", mayImport: [] },
  { layer: "packages/ui/scripts", mayImport: ["packages/ui/src/tokens.ts"] },
  { layer: "packages/client/src", mayImport: ["packages/contracts/src"] },
  { layer: "apps/panel/src", mayImport: ["packages/contracts/src", "packages/client/src", "packages/ui/src"] },
  {
    layer: "apps/worker/src/adapters",
    mayImport: [
      "packages/core/src",
      "packages/contracts/src",
      "packages/ui/src/tokens.ts",
      "apps/worker/src/runtime/env.ts",
      "apps/worker/src/runtime/wire.ts",
    ],
    cloudflare: true,
  },
  {
    layer: "apps/worker/src/runtime",
    mayImport: ["packages/core/src", "packages/contracts/src", "apps/worker/src/adapters"],
    cloudflare: true,
  },
  { layer: "apps/worker/test", mayImport: ["apps/worker/src", "packages/core/src", "packages/contracts/src"], cloudflare: true },
  { layer: "apps/worker/scripts", mayImport: [] },
  { layer: "apps/worker/vitest.config.ts", mayImport: [] },
  { layer: "apps/panel/vite.config.ts", mayImport: [] },
  { layer: "apps/panel/playwright.config.ts", mayImport: [] },
  { layer: "apps/panel/e2e", mayImport: ["packages/contracts/src"] },
];

/** Workspace packages resolve to their sources. */
const workspacePackages: Record<string, string> = {
  "@tiny-uptime/contracts": "packages/contracts/src/index.ts",
  "@tiny-uptime/core": "packages/core/src/index.ts",
  "@tiny-uptime/ui": "packages/ui/src",
  "@tiny-uptime/client": "packages/client/src/index.ts",
};

const SOURCE = /\.(ts|tsx|mts|js|mjs)$/;
const SKIP = new Set(["node_modules", "dist", ".wrangler", ".turbo", "test-results", "playwright-report"]);

function files(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(files(path));
    else if (SOURCE.test(entry.name) && !entry.name.endsWith(".gen.ts")) out.push(path);
  }
  return out;
}

function imports(file: string): string[] {
  const result = parseSync(file, readFileSync(file, "utf8"));
  if (result.errors.length) throw new Error(`${file}: syntax error`);
  const found: string[] = [];
  for (const i of result.module.staticImports) found.push(i.moduleRequest.value);
  for (const e of result.module.staticExports)
    for (const entry of e.entries) if (entry.moduleRequest) found.push(entry.moduleRequest.value);
  const source = readFileSync(file, "utf8");
  for (const d of result.module.dynamicImports) {
    const text = source.slice(d.moduleRequest.start, d.moduleRequest.end);
    if (!/^["'`]/.test(text)) throw new Error(`${file}: dynamic import with a computed path`);
    found.push(text.slice(1, -1));
  }
  return found;
}

function ruleFor(path: string): Rule | undefined {
  return rules.filter((r) => path === r.layer || path.startsWith(`${r.layer}/`)).toSorted((a, b) => b.layer.length - a.layer.length)[0];
}

function within(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(prefix.replace(/\.ts$/, ""));
}

function resolveRelative(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return relative(root, candidate);
    } catch {}
  }
  return relative(root, base);
}

function declaredDependencies(file: string): Set<string> {
  let dir = dirname(file);
  while (dir.startsWith(root)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    } catch {
      dir = dirname(dir);
    }
  }
  return new Set();
}

/** The file a workspace import lands on, so `@tiny-uptime/ui/tokens` is told apart from the components. */
function workspaceTarget(specifier: string): string | undefined {
  const name = packageName(specifier);
  const entry = workspacePackages[name];
  const subpath = specifier.slice(name.length + 1);
  if (!entry || !subpath || /\.tsx?$/.test(entry)) return entry;
  return resolveRelative(join(root, entry, "index.ts"), `./${subpath}`);
}

function packageName(specifier: string): string {
  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
}

const problems: string[] = [];
const sources = [...files(join(root, "packages")), ...files(join(root, "apps"))];

for (const file of sources) {
  const path = relative(root, file);
  const rule = ruleFor(path);
  if (!rule) {
    problems.push(`${path}: no layer rule covers this file`);
    continue;
  }
  const declared = declaredDependencies(file);
  const rootDeclared = declaredDependencies(join(root, "package.json"));
  for (const specifier of imports(file)) {
    if (specifier.startsWith("node:") || builtinModules.includes(specifier)) {
      if (!/\/(scripts|test|e2e)\/|\.config\.ts$/.test(path)) problems.push(`${path}: imports Node built-in ${specifier}`);
      continue;
    }
    if (specifier.startsWith("cloudflare:")) {
      if (!rule.cloudflare) problems.push(`${path}: imports ${specifier}, but only apps/worker may use Cloudflare APIs`);
      continue;
    }
    const internal = specifier.startsWith(".") ? resolveRelative(file, specifier) : workspaceTarget(specifier);
    if (internal) {
      if (specifier.startsWith("@") && !declared.has(packageName(specifier)))
        problems.push(`${path}: imports ${specifier} without declaring it`);
      const sameLayer = within(internal, rule.layer);
      if (!sameLayer && !rule.mayImport.some((allowed) => within(internal, allowed))) {
        problems.push(`${path}: ${rule.layer} may not import ${internal}`);
      }
      continue;
    }
    const name = packageName(specifier);
    if (!declared.has(name) && !rootDeclared.has(name)) problems.push(`${path}: imports ${name} without declaring it in package.json`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} boundary violation(s).`);
  process.exit(1);
}
console.log(`Boundaries ok: ${sources.length} files checked.`);
