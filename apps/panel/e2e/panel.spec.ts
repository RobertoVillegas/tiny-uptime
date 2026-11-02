import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const OPERATOR = { authorization: "Bearer e2e-operator-token" };

/** Chromium's virtual authenticator stands in for Touch ID: it creates and uses real passkeys. */
async function addAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`)).toEqual([]);
}

test("an invited owner signs up with a passkey, adds a heartbeat and signs back in", async ({ page, request }) => {
  const slug = `e2e-${Date.now()}`;
  const workspace = await (await request.post("/api/admin/workspaces", { headers: OPERATOR, data: { name: "E2E Co", slug } })).json();
  const invite = await (
    await request.post("/api/admin/invites", { headers: OPERATOR, data: { workspaceId: workspace.id, email: "ana@example.com" } })
  ).json();
  await addAuthenticator(page);

  // Sign up from the invite.
  await page.goto(new URL(invite.inviteUrl).pathname + new URL(invite.inviteUrl).search);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByText("E2E Co")).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("Your name").fill("Ana");
  await page.getByRole("button", { name: "Create passkey and join" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(10);
  await page.getByRole("button", { name: "I saved them, continue" }).click();

  // Empty workspace, then a heartbeat monitor.
  await expect(page.getByRole("heading", { name: "Monitors" })).toBeVisible();
  await expect(page.getByText("No monitors yet")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "New monitor" }).click();
  await page.getByRole("combobox", { name: "What to monitor" }).click();
  await page.getByRole("option", { name: /Heartbeat/ }).click();
  await page.getByLabel("Name", { exact: true }).fill("Nightly backup");
  await page.getByRole("button", { name: "Create monitor" }).click();
  await expect(page.getByRole("heading", { name: "Nightly backup" })).toBeVisible();
  await expect(page.getByText("Pending")).toBeVisible();
  await expectAccessible(page);

  // A ping marks it up.
  const heartbeatUrl = await page.locator("code").filter({ hasText: "/api/heartbeat/" }).textContent();
  expect((await request.get(new URL(heartbeatUrl!).pathname)).status()).toBe(200);
  await page.reload();
  await expect(page.getByText("Up", { exact: true })).toBeVisible();

  // Validation errors show next to the field.
  await page.getByRole("link", { name: "Monitors" }).first().click();
  await page.getByRole("button", { name: "New monitor" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Broken");
  await page.getByLabel("URL", { exact: true }).fill("ftp://nope");
  await page.getByRole("button", { name: "Create monitor" }).click();
  await expect(page.getByRole("alert")).toContainText(/URL/i);
  await page.getByRole("button", { name: "Cancel" }).click();

  // Sign out and back in with the same passkey.
  await page.getByRole("button", { name: /Ana/ }).first().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page.getByRole("heading", { name: "Monitors" })).toBeVisible();
  await expect(page.getByText("Nightly backup")).toBeVisible();

  // Account page lists the passkey.
  await page.goto("/app/account");
  await expect(page.getByRole("heading", { name: "Account and security" })).toBeVisible();
  await expect(page.getByText(/Last used/)).toBeVisible();
  await expectAccessible(page);
});

test("signed-out visitors are sent to sign in, and the panel cannot be framed", async ({ page }) => {
  const res = await page.goto("/app/monitors");
  expect(res?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/app/login");
});
