import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { base32Decode, STEP_SECONDS, totpAt, verifyTotp } from "../src/auth/totp";
import { VirtualAuthenticator } from "./authenticator";

const ORIGIN = "https://tiny.test";
const OPERATOR = "test-operator-token";

type Res = { status: number; body: any; cookie: string | null };

/** A browser tab: keeps the session cookie and sends our Origin on writes. */
class Browser {
  cookie: string | null = null;

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const h: Record<string, string> = { origin: ORIGIN, ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h["content-type"] = "application/json";
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}${path}`, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
    );
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const pair = setCookie.split(";")[0]!;
      this.cookie = pair.endsWith("=") ? null : pair;
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, cookie: setCookie };
  }
}

async function operator(method: string, path: string, body: unknown) {
  const res = await exports.default.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: { authorization: `Bearer ${OPERATOR}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json<any>() };
}

async function newWorkspace() {
  const slug = `w-${crypto.randomUUID().slice(0, 8)}`;
  return (await operator("POST", "/api/admin/workspaces", { name: "Acme", slug })).body as { id: string; apiKey: string };
}

async function invite(workspaceId: string, email: string, role = "owner") {
  const res = await operator("POST", "/api/admin/invites", { workspaceId, email, role });
  expect(res.status).toBe(201);
  return new URL(res.body.inviteUrl).searchParams.get("token")!;
}

/** Accepts an invite in a fresh browser with a new passkey. */
async function signUp(token: string, name = "Ana") {
  const browser = new Browser();
  const passkey = await VirtualAuthenticator.create();
  const options = await browser.call("POST", "/auth/invite/options", { token, name });
  expect(options.status).toBe(200);
  const registration = await passkey.register({ challenge: options.body.challenge, origin: ORIGIN });
  const done = await browser.call("POST", "/auth/invite/complete", { token, name, challengeId: options.body.challengeId, registration, label: "Laptop" });
  return { browser, passkey, done };
}

async function signIn(browser: Browser, passkey: VirtualAuthenticator, tweak: { origin?: string; rpId?: string; bumpCounter?: boolean } = {}) {
  const options = await browser.call("POST", "/auth/login/options", {});
  const authentication = await passkey.authenticate({
    challenge: options.body.challenge,
    origin: tweak.origin ?? ORIGIN,
    ...(tweak.rpId ? { rpId: tweak.rpId } : {}),
    ...(tweak.bumpCounter === false ? { bumpCounter: false } : {}),
  });
  return { options, res: await browser.call("POST", "/auth/login/complete", { challengeId: options.body.challengeId, authentication }) };
}

function email() {
  return `${crypto.randomUUID().slice(0, 8)}@example.com`;
}

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 test vectors", async () => {
    const secret = new TextEncoder().encode("12345678901234567890");
    expect(await totpAt(secret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(await totpAt(secret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(await totpAt(secret, Math.floor(20000000000 / 30), 8)).toBe("65353130");
  });

  it("accepts a code once and allows one step of drift", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / STEP_SECONDS);
    const code = await totpAt(base32Decode(secret), step);
    expect(await verifyTotp(secret, code, now, null)).toBe(step);
    expect(await verifyTotp(secret, code, now, step)).toBeNull();
    expect(await verifyTotp(secret, await totpAt(base32Decode(secret), step + 1), now, null)).toBe(step + 1);
    expect(await verifyTotp(secret, await totpAt(base32Decode(secret), step + 2), now, null)).toBeNull();
    expect(await verifyTotp(secret, "12345", now, null)).toBeNull();
  });
});

describe("sign-up and sign-in with passkeys", () => {
  it("signs up from an invite and uses the session in the API", async () => {
    const ws = await newWorkspace();
    const token = await invite(ws.id, email());
    const info = await new Browser().call("GET", `/auth/invite?token=${token}`);
    expect(info.body).toMatchObject({ workspaceName: "Acme", role: "owner", existingUser: false });

    const { browser, done } = await signUp(token);
    expect(done.status).toBe(201);
    expect(done.body.recoveryCodes).toHaveLength(10);
    expect(done.cookie).toMatch(/^__Host-tu_session=[0-9a-f]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax/);

    const me = await browser.call("GET", "/auth/me");
    expect(me.body).toMatchObject({ name: "Ana", totpEnabled: false, recoveryCodesLeft: 10 });
    expect(me.body.memberships).toEqual([{ workspaceId: ws.id, workspaceName: "Acme", role: "owner" }]);
    expect(me.body.passkeys).toHaveLength(1);

    const created = await browser.call("POST", "/api/v1/monitors", { type: "http", name: "S", url: "https://s.test/" }, { "x-workspace-id": ws.id });
    expect(created.status).toBe(201);
    expect((await browser.call("GET", "/api/v1/monitors", undefined, { "x-workspace-id": "aaaaaaaaaaaa" })).status).toBe(404);

    // The invite works once.
    expect((await new Browser().call("POST", "/auth/invite/options", { token, name: "x" })).status).toBe(404);
  });

  it("refuses cookie-authenticated writes from another origin", async () => {
    const ws = await newWorkspace();
    const { browser } = await signUp(await invite(ws.id, email()));
    const res = await browser.call("POST", "/api/v1/monitors", { type: "http", name: "S", url: "https://s.test/" }, { "x-workspace-id": ws.id, origin: "https://evil.test" });
    expect(res.status).toBe(403);
    expect((await browser.call("POST", "/auth/logout", {}, { origin: "https://evil.test" })).status).toBe(403);
  });

  it("signs in with the passkey and refuses replays, foreign origins and stale counters", async () => {
    const ws = await newWorkspace();
    const { browser, passkey } = await signUp(await invite(ws.id, email()));
    await browser.call("POST", "/auth/logout", {});
    expect((await browser.call("GET", "/auth/me")).status).toBe(401);

    const { options, res } = await signIn(browser, passkey);
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe("full");
    expect((await browser.call("GET", "/auth/me")).status).toBe(200);

    // The same challenge cannot be used twice.
    const again = await passkey.authenticate({ challenge: options.body.challenge, origin: ORIGIN });
    expect((await new Browser().call("POST", "/auth/login/complete", { challengeId: options.body.challengeId, authentication: again })).status).toBe(400);

    expect((await signIn(new Browser(), passkey, { origin: "https://evil.test" })).res.status).toBe(401);
    expect((await signIn(new Browser(), passkey, { rpId: "evil.test" })).res.status).toBe(401);
    // A counter that does not move past the stored one (1, from the sign-in above) means a cloned key.
    passkey.counter = 1;
    expect((await signIn(new Browser(), passkey, { bumpCounter: false })).res.status).toBe(401);
    expect((await signIn(new Browser(), await VirtualAuthenticator.create())).res.status).toBe(401);
  });

  it("requires user verification when registering", async () => {
    const ws = await newWorkspace();
    const token = await invite(ws.id, email());
    const browser = new Browser();
    const passkey = await VirtualAuthenticator.create();
    const options = await browser.call("POST", "/auth/invite/options", { token, name: "Ana" });
    const registration = await passkey.register({ challenge: options.body.challenge, origin: ORIGIN, userVerified: false });
    const res = await browser.call("POST", "/auth/invite/complete", { token, name: "Ana", challengeId: options.body.challengeId, registration });
    expect(res.status).toBe(400);
  });

  it("keeps the last passkey and adds new ones", async () => {
    const ws = await newWorkspace();
    const { browser } = await signUp(await invite(ws.id, email()));
    const me = await browser.call("GET", "/auth/me");
    expect((await browser.call("DELETE", `/auth/passkeys/${me.body.passkeys[0].id}`)).status).toBe(400);

    const second = await VirtualAuthenticator.create();
    const options = await browser.call("POST", "/auth/passkeys/options", {});
    const registration = await second.register({ challenge: options.body.challenge, origin: ORIGIN });
    expect((await browser.call("POST", "/auth/passkeys", { challengeId: options.body.challengeId, registration, label: "Phone" })).status).toBe(201);
    expect((await browser.call("DELETE", `/auth/passkeys/${me.body.passkeys[0].id}`)).status).toBe(200);
    await browser.call("POST", "/auth/logout", {});
    expect((await signIn(browser, second)).res.status).toBe(200);
  });
});

describe("second factor and recovery", () => {
  it("asks for a TOTP code after the passkey once enabled, and a code works once", async () => {
    const ws = await newWorkspace();
    const { browser, passkey } = await signUp(await invite(ws.id, email()));
    const setup = await browser.call("POST", "/auth/totp/setup", {});
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\/tiny-uptime%3A/);
    const secret = base32Decode(setup.body.secret);
    const step = Math.floor(Date.now() / 1000 / STEP_SECONDS);
    expect((await browser.call("POST", "/auth/totp/confirm", { code: "000000" })).status).toBe(400);
    expect((await browser.call("POST", "/auth/totp/confirm", { code: await totpAt(secret, step) })).status).toBe(200);

    await browser.call("POST", "/auth/logout", {});
    const login = await signIn(browser, passkey);
    expect(login.res.body.stage).toBe("mfa");
    // Half signed in: no access to the API or the account yet.
    expect((await browser.call("GET", "/auth/me")).status).toBe(401);
    expect((await browser.call("GET", "/api/v1/monitors", undefined, { "x-workspace-id": ws.id })).status).toBe(401);

    // The code used to enable TOTP cannot be replayed.
    expect((await browser.call("POST", "/auth/mfa", { code: await totpAt(secret, step) })).status).toBe(401);
    expect((await browser.call("POST", "/auth/mfa", { code: await totpAt(secret, step + 1) })).status).toBe(200);
    expect((await browser.call("GET", "/auth/me")).body.totpEnabled).toBe(true);
  });

  it("signs in with a recovery code once", async () => {
    const ws = await newWorkspace();
    const address = email();
    const { done } = await signUp(await invite(ws.id, address));
    const code = done.body.recoveryCodes[0];
    const browser = new Browser();
    expect((await browser.call("POST", "/auth/recovery", { email: address, code: "wrong-code1" })).status).toBe(401);
    const ok = await browser.call("POST", "/auth/recovery", { email: address, code });
    expect(ok.status).toBe(200);
    expect((await browser.call("GET", "/auth/me")).body.recoveryCodesLeft).toBe(9);
    expect((await new Browser().call("POST", "/auth/recovery", { email: address, code })).status).toBe(401);
  });

  it("locks recovery after repeated failures", async () => {
    const ws = await newWorkspace();
    const address = email();
    const { done } = await signUp(await invite(ws.id, address));
    for (let i = 0; i < 5; i++) await new Browser().call("POST", "/auth/recovery", { email: address, code: `bad-${i}` });
    const locked = await new Browser().call("POST", "/auth/recovery", { email: address, code: done.body.recoveryCodes[0] });
    expect(locked.status).toBe(401);
    expect(locked.body.error).toMatch(/too many attempts/);
  });
});

describe("members and roles", () => {
  it("lets owners invite viewers who can read but not change", async () => {
    const ws = await newWorkspace();
    const { browser: owner } = await signUp(await invite(ws.id, email()));
    const viewerEmail = email();
    const inv = await owner.call("POST", `/auth/workspaces/${ws.id}/invites`, { email: viewerEmail, role: "viewer" });
    expect(inv.status).toBe(201);
    const { browser: viewer } = await signUp(new URL(inv.body.inviteUrl).searchParams.get("token")!, "Vic");

    const headers = { "x-workspace-id": ws.id };
    expect((await viewer.call("GET", "/api/v1/monitors", undefined, headers)).status).toBe(200);
    expect((await viewer.call("POST", "/api/v1/monitors", { type: "http", name: "x", url: "https://x.test/" }, headers)).status).toBe(403);
    expect((await viewer.call("GET", "/api/v1/api-keys", undefined, headers)).status).toBe(403);
    expect((await viewer.call("POST", `/auth/workspaces/${ws.id}/invites`, { email: email() })).status).toBe(403);

    const members = await owner.call("GET", `/auth/workspaces/${ws.id}/members`);
    expect(members.body.members.map((m: { role: string }) => m.role).sort()).toEqual(["owner", "viewer"]);
    const ownerId = members.body.members.find((m: { role: string }) => m.role === "owner").userId;
    expect((await owner.call("PATCH", `/auth/workspaces/${ws.id}/members/${ownerId}`, { role: "viewer" })).status).toBe(400);
  });

  it("refuses an invite for an existing email at sign-up and accepts it after sign-in", async () => {
    const a = await newWorkspace();
    const b = await newWorkspace();
    const address = email();
    const { browser } = await signUp(await invite(a.id, address));
    const second = await invite(b.id, address, "editor");
    expect((await new Browser().call("POST", "/auth/invite/options", { token: second, name: "Ana" })).status).toBe(409);
    expect((await browser.call("POST", "/auth/invite/accept", { token: second })).status).toBe(200);
    const me = await browser.call("GET", "/auth/me");
    expect(me.body.memberships.map((m: { role: string }) => m.role).sort()).toEqual(["editor", "owner"]);
  });
});
