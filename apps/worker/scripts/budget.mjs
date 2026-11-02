// Fails when the Worker outgrows its budget: bundle size (gzip) and startup CPU.
//
// Startup is profiled locally with `wrangler check startup`. The absolute number depends on the
// machine (about 5 ms on an M-series Mac, 11 ms on a GitHub runner, 3 ms on Cloudflare), so the
// budget applies to the cost above an empty Worker profiled on the same machine. Each side takes
// the median of five runs, since a single profile is noisy. Slower machines can raise the startup
// limit with STARTUP_BUDGET_MS (CI does, see .github/workflows/ci.yml).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET = { gzipKiB: 100, startupOverEmptyMs: Number(process.env.STARTUP_BUDGET_MS ?? 10) };
const RUNS = 5;
const wrangler = join(import.meta.dirname, "..", "node_modules", ".bin", "wrangler");
const dir = mkdtempSync(join(tmpdir(), "tiny-uptime-budget-"));

function startupMs(cwd) {
  const runs = Array.from({ length: RUNS }, () => {
    const out = execFileSync(wrangler, ["check", "startup", "--outfile", join(dir, "startup.cpuprofile")], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ms = Number(/Active:\s*([\d.]+)\s*ms/.exec(out)?.[1]);
    if (Number.isNaN(ms)) throw new Error(`could not read the startup profile:\n${out}`);
    return ms;
  });
  return { median: runs.toSorted((a, b) => a - b)[Math.floor(RUNS / 2)], runs };
}

try {
  execFileSync(wrangler, ["deploy", "--dry-run", "--outdir", join(dir, "bundle")], { stdio: "pipe" });
  const entry = readdirSync(join(dir, "bundle")).find((f) => f.endsWith(".js"));
  const gzipKiB = gzipSync(readFileSync(join(dir, "bundle", entry))).length / 1024;

  const empty = join(dir, "empty");
  execFileSync("mkdir", ["-p", empty]);
  writeFileSync(join(empty, "index.js"), 'export default { fetch() { return new Response("ok"); } };\n');
  writeFileSync(join(empty, "wrangler.json"), JSON.stringify({ name: "empty", main: "index.js", compatibility_date: "2026-09-01" }));

  const ours = startupMs(process.cwd());
  const baseline = startupMs(empty);
  const over = Math.max(0, ours.median - baseline.median);

  const rows = [
    ["bundle (gzip)", `${gzipKiB.toFixed(1)} KiB`, `${BUDGET.gzipKiB} KiB`, gzipKiB <= BUDGET.gzipKiB],
    [
      "startup over an empty Worker",
      `${over.toFixed(1)} ms (ours ${ours.runs.join(", ")}; empty ${baseline.runs.join(", ")})`,
      `${BUDGET.startupOverEmptyMs} ms`,
      over <= BUDGET.startupOverEmptyMs,
    ],
  ];
  for (const [name, value, limit, ok] of rows) console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${value} (budget ${limit})`);
  if (rows.some((r) => !r[3])) process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
