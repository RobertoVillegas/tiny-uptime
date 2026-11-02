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

const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

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

test("alert rules, maintenance and follow-ups can be set from the panel", async ({ page, request }) => {
  const workspace = await (
    await request.post("/api/admin/workspaces", { headers: OPERATOR, data: { name: "Ops", slug: `ops-${Date.now()}` } })
  ).json();
  const key = { authorization: `Bearer ${workspace.apiKey}` };
  await request.post("/api/v1/channels", { headers: key, data: { type: "webhook", name: "Pager", url: "https://example.com/hook" } });
  const invite = await (
    await request.post("/api/admin/invites", { headers: OPERATOR, data: { workspaceId: workspace.id, email: "ops@example.com" } })
  ).json();
  await addAuthenticator(page);
  await page.goto(new URL(invite.inviteUrl).pathname + new URL(invite.inviteUrl).search);
  await page.getByLabel("Your name").fill("Ops");
  await page.getByRole("button", { name: "Create passkey and join" }).click();
  await page.getByRole("button", { name: "I saved them, continue" }).click();

  // A heartbeat with stricter rules, a tag and a routed channel.
  await page.getByRole("button", { name: "New monitor" }).click();
  await page.getByRole("combobox", { name: "What to monitor" }).click();
  await page.getByRole("option", { name: /Heartbeat/ }).click();
  await page.getByLabel("Name", { exact: true }).fill("Backups");
  await page.getByRole("button", { name: /Alert rules/ }).click();
  await page.getByLabel("Down after").fill("3");
  await page.getByLabel("Tags").fill("nightly, storage");
  await page.getByRole("checkbox", { name: "Pager" }).click();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Create monitor" }).click();
  await expect(page.getByRole("heading", { name: "Backups", exact: true })).toBeVisible();
  const monitors = await (await request.get("/api/v1/monitors", { headers: key })).json();
  expect(monitors[0]).toMatchObject({ failureThreshold: 3, tags: ["nightly", "storage"] });
  expect(monitors[0].channelIds).toHaveLength(1);

  // Tag filter on the list.
  await page.getByRole("link", { name: "Monitors" }).first().click();
  await expect(page.getByRole("button", { name: "nightly" })).toBeVisible();

  // Maintenance that is in progress now.
  await page.getByRole("link", { name: "Maintenance" }).first().click();
  await expect(page.getByText("Nothing scheduled")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Schedule maintenance" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Storage migration");
  await page.getByLabel("Starts").fill(local(new Date(Date.now() - 10 * 60_000)));
  await page.getByLabel("Ends").fill(local(new Date(Date.now() + 60 * 60_000)));
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.getByText("In progress", { exact: true })).toBeVisible();

  // Follow-ups on the alerts page.
  await page.getByRole("link", { name: "Alerts" }).first().click();
  await page.getByRole("combobox", { name: "Remind" }).click();
  await page.getByRole("option", { name: "Every 30 minutes" }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
  await page.getByRole("button", { name: "Save follow-ups" }).click();
  await expect(page.getByText("Follow-up rules saved")).toBeVisible();
  expect((await (await request.get("/api/v1/alert-policy", { headers: key })).json()).reminderEveryMinutes).toBe(30);
  await expectAccessible(page);
});

test("a status page is published from the panel and served publicly", async ({ page, request }) => {
  const workspace = await (
    await request.post("/api/admin/workspaces", { headers: OPERATOR, data: { name: "Pub", slug: `pub-${Date.now()}` } })
  ).json();
  const key = { authorization: `Bearer ${workspace.apiKey}` };
  await request.post("/api/v1/monitors", { headers: key, data: { type: "heartbeat", name: "Checkout API", paused: true } });
  await request.post("/api/v1/monitors", { headers: key, data: { type: "heartbeat", name: "Secret job", paused: true } });
  const invite = await (
    await request.post("/api/admin/invites", { headers: OPERATOR, data: { workspaceId: workspace.id, email: "pub@example.com" } })
  ).json();
  await addAuthenticator(page);
  await page.goto(new URL(invite.inviteUrl).pathname + new URL(invite.inviteUrl).search);
  await page.getByLabel("Your name").fill("Pub");
  await page.getByRole("button", { name: "Create passkey and join" }).click();
  await page.getByRole("button", { name: "I saved them, continue" }).click();

  await page.getByRole("link", { name: "Status pages" }).first().click();
  await expect(page.getByText("No status pages yet")).toBeVisible();
  await page.getByRole("link", { name: "New status page" }).click();
  const slug = `pub-page-${Date.now()}`;
  await page.getByLabel("Title").fill("Pub status");
  await page.getByLabel("Address").fill(slug);
  await page.getByRole("combobox", { name: "Add a monitor" }).click();
  await page.getByRole("option", { name: "Checkout API" }).click();
  await expect(page.getByLabel("Group for Checkout API")).toHaveValue("Services");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Publish page" }).click();
  await expect(page.getByRole("heading", { name: "Pub status" })).toBeVisible();

  const html = await (await request.get(`/s/${slug}`)).text();
  expect(html).toContain("Pub status");
  expect(html).toContain("Checkout API");
  expect(html).not.toContain("Secret job");
});

test("alert channels of other types can be added, and show no secrets", async ({ page, request }) => {
  const workspace = await (
    await request.post("/api/admin/workspaces", { headers: OPERATOR, data: { name: "Alerts", slug: `alerts-${Date.now()}` } })
  ).json();
  const key = { authorization: `Bearer ${workspace.apiKey}` };
  const invite = await (
    await request.post("/api/admin/invites", { headers: OPERATOR, data: { workspaceId: workspace.id, email: "alerts@example.com" } })
  ).json();
  await addAuthenticator(page);
  await page.goto(new URL(invite.inviteUrl).pathname + new URL(invite.inviteUrl).search);
  await page.getByLabel("Your name").fill("Alerts");
  await page.getByRole("button", { name: "Create passkey and join" }).click();
  await page.getByRole("button", { name: "I saved them, continue" }).click();

  await page.getByRole("link", { name: "Alerts" }).first().click();
  await page.getByRole("button", { name: "New channel" }).click();
  await page.getByRole("combobox", { name: "Send alerts to" }).click();
  await page.getByRole("option", { name: "Telegram" }).click();
  await page.getByLabel("Name", { exact: true }).fill("My phone");
  await page.getByLabel("Bot token").fill("123456789:AAEhBP0av18ZZ-fake_token_value_1234");
  await page.getByLabel("Chat ID").fill("me");
  await page.getByRole("button", { name: "Add channel" }).click();
  await expect(page.getByText("Must be a numeric chat id or @channelusername")).toBeVisible();
  await page.getByLabel("Chat ID").fill("-1001234567890");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Add channel" }).click();
  await expect(page.getByText("Telegram · chat -1001234567890")).toBeVisible();

  await page.getByRole("button", { name: "New channel" }).click();
  await page.getByRole("combobox", { name: "Send alerts to" }).click();
  await page.getByRole("option", { name: "ntfy" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Push");
  await page.getByLabel("Server").fill("https://ntfy.example.com");
  await page.getByLabel("Topic").fill("hidden-topic");
  await page.getByRole("combobox", { name: "Priority" }).click();
  await page.getByRole("option", { name: "5 · Urgent" }).click();
  await page.getByRole("button", { name: "Add channel" }).click();
  await expect(page.getByText("ntfy · ntfy.example.com/••••••••")).toBeVisible();

  const listed = await (await request.get("/api/v1/channels", { headers: key })).text();
  expect(listed).not.toContain("AAEhBP0av18ZZ");
  expect(listed).not.toContain("hidden-topic");
  await expectAccessible(page);
});

test("the form sends each new monitor type's own fields", async ({ page, request }) => {
  const workspace = await (
    await request.post("/api/admin/workspaces", { headers: OPERATOR, data: { name: "Types", slug: `types-${Date.now()}` } })
  ).json();
  const key = { authorization: `Bearer ${workspace.apiKey}` };
  const invite = await (
    await request.post("/api/admin/invites", { headers: OPERATOR, data: { workspaceId: workspace.id, email: "types@example.com" } })
  ).json();
  await addAuthenticator(page);
  await page.goto(new URL(invite.inviteUrl).pathname + new URL(invite.inviteUrl).search);
  await page.getByLabel("Your name").fill("Types");
  await page.getByRole("button", { name: "Create passkey and join" }).click();
  await page.getByRole("button", { name: "I saved them, continue" }).click();

  const create = async (type: RegExp, name: string, fill: () => Promise<void>) => {
    await page.getByRole("link", { name: "Monitors" }).first().click();
    await page.getByRole("button", { name: "New monitor" }).click();
    await page.getByRole("combobox", { name: "What to monitor" }).click();
    await page.getByRole("option", { name: type }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await fill();
    await page.getByRole("button", { name: "Create monitor" }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  };

  await create(/DNS record/, "Mail", async () => {
    await page.getByLabel("Record name").fill("example.com");
    await page.getByRole("combobox", { name: "Record type" }).click();
    await page.getByRole("option", { name: "MX", exact: true }).click();
    await page.getByLabel("Expected value").fill("10 mail.example.com");
    await expectAccessible(page);
  });
  await create(/Domain registration/, "Registration", async () => {
    await expect(page.getByRole("combobox", { name: "Check" })).toHaveText(/Every day/);
    await page.getByLabel("Domain", { exact: true }).fill("example.com");
    await page.getByLabel("Warn days ahead").fill("21");
  });
  await create(/PostgreSQL/, "Database", async () => {
    await expect(page.getByLabel("Port")).toHaveAttribute("placeholder", "5432");
    await page.getByLabel("Host").fill("db.example.com");
  });

  const monitors = (await (await request.get("/api/v1/monitors", { headers: key })).json()) as Record<string, unknown>[];
  const byName = Object.fromEntries(monitors.map((m) => [m.name, m]));
  expect(byName.Mail).toMatchObject({
    type: "dns",
    host: "example.com",
    recordType: "MX",
    expected: { value: "10 mail.example.com", mode: "exact" },
  });
  expect(byName.Registration).toMatchObject({ type: "domain", domain: "example.com", warnDays: 21, intervalSec: 86_400 });
  expect(byName.Database).toMatchObject({ type: "postgres", host: "db.example.com", port: 5432 });
});
