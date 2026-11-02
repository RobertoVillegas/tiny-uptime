import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;

/**
 * Runs the real Worker with `wrangler dev`, serving the built panel, on localhost so passkeys work
 * (WebAuthn needs a secure context and a hostname, not an IP). State lives in a fresh directory per run.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  // Reduced motion makes the CSS skip transitions, so accessibility checks never measure an element
  // mid-fade (which reads as low contrast), and the reduced-motion path is exercised on every run.
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", contextOptions: { reducedMotion: "reduce" } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `rm -rf .wrangler/e2e && pnpm --filter @tiny-uptime/worker exec wrangler dev --port ${PORT} --ip localhost --persist-to ../panel/.wrangler/e2e --var ADMIN_TOKEN:e2e-operator-token --var PUBLIC_SLUG:e2e`,
    url: `http://localhost:${PORT}/app/login`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
