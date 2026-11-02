// Fails when the Worker outgrows its budget: bundle size (gzip) and startup CPU.
// Startup is profiled locally with `wrangler check startup`, three times, keeping the
// median: a single local profile is noisy (the first run on a cold machine can be 30+ ms).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET = { gzipKiB: 100, startupActiveMs: 10 };
const wrangler = join(import.meta.dirname, "..", "node_modules", ".bin", "wrangler");
const dir = mkdtempSync(join(tmpdir(), "tiny-uptime-budget-"));

try {
  execFileSync(wrangler, ["deploy", "--dry-run", "--outdir", dir], { stdio: "pipe" });
  const entry = readdirSync(dir).find((f) => f.endsWith(".js"));
  const bundle = readFileSync(join(dir, entry));
  const gzipKiB = gzipSync(bundle).length / 1024;

  const runs = [1, 2, 3].map(() => {
    const profile = execFileSync(wrangler, ["check", "startup", "--outfile", join(dir, "startup.cpuprofile")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ms = Number(/Active:\s*([\d.]+)\s*ms/.exec(profile)?.[1]);
    if (Number.isNaN(ms)) throw new Error("could not read the startup profile:\n" + profile);
    return ms;
  });
  const active = runs.sort((a, b) => a - b)[1];

  const rows = [
    ["bundle (gzip)", `${gzipKiB.toFixed(1)} KiB`, `${BUDGET.gzipKiB} KiB`, gzipKiB <= BUDGET.gzipKiB],
    ["startup (active, local)", `${active} ms (runs ${runs.join(", ")})`, `${BUDGET.startupActiveMs} ms`, active <= BUDGET.startupActiveMs],
  ];
  for (const [name, value, limit, ok] of rows) console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${value} (budget ${limit})`);
  if (rows.some((r) => !r[3])) process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
