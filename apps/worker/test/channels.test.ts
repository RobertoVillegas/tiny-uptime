import { runInDurableObject } from "cloudflare:test";
import { env as runtimeEnv, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertEvent } from "@tiny-uptime/core";
import { sendEmail } from "../src/adapters/notify/email";
import { createNotifier } from "../src/adapters/notify/notifier";
import { sendNtfy } from "../src/adapters/notify/ntfy";
import { sendSlack } from "../src/adapters/notify/slack";
import { sendTeams } from "../src/adapters/notify/teams";
import type { Env } from "../src/runtime/env";
import type { Workspace } from "../src/runtime/workspace-object";

const env = runtimeEnv as unknown as Env;
const BASE = "https://tiny.test";

type Sent = { url: string; headers: Record<string, string>; body: any; redirect?: string };
let sent: Sent[] = [];
/** How each receiver answers, by URL prefix; anything else is a monitored site that answers `sites[url]`. */
let receivers: Record<string, () => Response> = {};
let sites: Record<string, number> = {};

const TELEGRAM_TOKEN = "123456789:AAEhBP0av18ZZ-fake_token_value_1234";
const ROUTING_KEY = "R0UTINGKEY0000000000000000abcd12";

beforeEach(() => {
  sent = [];
  sites = {};
  receivers = {};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const receiver = Object.entries(receivers).find(([prefix]) => url.startsWith(prefix));
    if (!url.includes(".test/") || receiver) {
      sent.push({
        url,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        ...(init?.redirect ? { redirect: init.redirect } : {}),
      });
      return receiver ? receiver[1]() : new Response("{}");
    }
    return new Response("ok", { status: sites[url] ?? 200 });
  });
});

afterEach(() => vi.restoreAllMocks());

async function call(method: string, path: string, key: string, body?: unknown) {
  const res = await exports.default.fetch(
    new Request(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

async function setup() {
  const res = await exports.default.fetch(
    new Request(`${BASE}/api/admin/workspaces`, {
      method: "POST",
      headers: { authorization: "Bearer test-operator-token", "content-type": "application/json" },
      body: JSON.stringify({ name: "Channels", slug: `ch-${crypto.randomUUID().slice(0, 8)}` }),
    }),
  );
  return (await res.json()) as { id: string; apiKey: string };
}

function stub(id: string) {
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(id));
}

async function create(key: string, body: Record<string, unknown>) {
  const res = await call("POST", "/api/v1/channels", key, body);
  expect(res.status, res.text).toBe(201);
  return res;
}

/** Creates a channel, sends it a test alert and returns what went out. */
async function testSend(body: Record<string, unknown>) {
  const ws = await setup();
  const created = await create(ws.apiKey, body);
  const test = await call("POST", `/api/v1/channels/${created.body.id}/test`, ws.apiKey);
  return { ws, channel: created.body, created, test, request: sent.at(-1)! };
}

describe("channel settings", () => {
  it("validates each type's settings and names the field", async () => {
    const { apiKey } = await setup();
    const field = async (body: Record<string, unknown>) =>
      (await call("POST", "/api/v1/channels", apiKey, { name: "x", ...body })).body.field;
    expect(await field({ type: "sms", url: "https://a.example/" })).toBe("type");
    expect(await field({ type: "slack", url: "ftp://hooks.example/x" })).toBe("url");
    for (const url of [
      "http://127.0.0.1/hook",
      "http://localhost:8080/hook",
      "https://10.1.2.3/hook",
      "https://192.168.0.122/hook",
      "http://[::1]/hook",
      "http://2130706433/hook",
      "https://db.internal/hook",
      "http://intranet/hook",
    ]) {
      expect(await field({ type: "webhook", url }), url).toBe("url");
    }
    const ntfy = { type: "ntfy", url: "https://ntfy.example", topic: "alerts" };
    expect(await field({ ...ntfy, url: "https://ntfy.example/alerts" })).toBe("url");
    expect(await field({ ...ntfy, topic: "no spaces" })).toBe("topic");
    expect(await field({ ...ntfy, topic: "x".repeat(65) })).toBe("topic");
    expect(await field({ ...ntfy, url: "http://ntfy.example", token: "tk_secret" })).toBe("token");
    expect(await field({ ...ntfy, priority: 7 })).toBe("priority");
    expect(await field({ type: "lark", url: "https://hooks.example/open-apis/bot/v2/hook/x" })).toBe("url");
    expect(await field({ type: "telegram", botToken: "../../evil", chatId: "1" })).toBe("botToken");
    expect(await field({ type: "telegram", botToken: TELEGRAM_TOKEN, chatId: "me" })).toBe("chatId");
    expect(await field({ type: "pagerduty", routingKey: "short" })).toBe("routingKey");
    expect(await field({ type: "email", to: "not-an-address" })).toBe("to");
  });

  it("reads webhook rows stored before other channel types existed", async () => {
    const ws = await setup();
    await runInDurableObject(stub(ws.id), (_: Workspace, state) => {
      state.storage.sql.exec(
        "INSERT INTO channel (id, type, name, config, enabled, created_at) VALUES ('legacychannel', 'webhook', 'Old', ?, 1, 1)",
        JSON.stringify({ url: "https://hooks.example/legacy-secret" }),
      );
    });
    const listed = await call("GET", "/api/v1/channels", ws.apiKey);
    expect(listed.body).toEqual([expect.objectContaining({ type: "webhook", host: "hooks.example", target: "hooks.example" })]);
    expect(listed.text).not.toContain("legacy-secret");
    expect((await call("POST", "/api/v1/channels/legacychannel/test", ws.apiKey)).status).toBe(200);
    expect(sent.at(-1)).toMatchObject({ url: "https://hooks.example/legacy-secret", body: { kind: "incident.opened", test: true } });
  });
});

describe("Slack", () => {
  it("posts text with Slack's reserved characters escaped", async () => {
    const { request, test, channel } = await testSend({
      type: "slack",
      name: "Ops",
      url: "https://hooks.slack.example/services/T0/B0/secret",
    });
    expect(test.status).toBe(200);
    expect(request.url).toBe("https://hooks.slack.example/services/T0/B0/secret");
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.body).toEqual({ text: "🔔 Test alert from tiny-uptime — this channel is connected." });
    expect(channel).toMatchObject({ type: "slack", host: "hooks.slack.example", target: "hooks.slack.example" });
    expect(JSON.stringify(channel)).not.toContain("secret");
  });
});

describe("Discord", () => {
  it("waits for the message and never mentions anyone", async () => {
    const { request } = await testSend({ type: "discord", name: "Ops", url: "https://discord.example/api/webhooks/1/tok" });
    expect(request.url).toBe("https://discord.example/api/webhooks/1/tok?wait=true");
    expect(request.body).toEqual({
      content: "🔔 Test alert from tiny-uptime — this channel is connected.",
      allowed_mentions: { parse: [] },
    });
  });
});

describe("Microsoft Teams", () => {
  it("sends an Adaptive Card in a message envelope", async () => {
    const { request } = await testSend({ type: "teams", name: "Ops", url: "https://prod.workflows.example/workflows/abc" });
    expect(request.body).toEqual({
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.2",
            body: [{ type: "TextBlock", text: "🔔 Test alert from tiny-uptime — this channel is connected.", wrap: true }],
            msteams: { width: "Full" },
          },
        },
      ],
    });
  });

  it("explains a Workflow that refuses anonymous callers", async () => {
    const ws = await setup();
    receivers["https://prod.workflows.example/"] = () => new Response("", { status: 401 });
    const channel = (await create(ws.apiKey, { type: "teams", name: "Ops", url: "https://prod.workflows.example/workflows/abc" })).body;
    const test = await call("POST", `/api/v1/channels/${channel.id}/test`, ws.apiKey);
    expect(test.status).toBe(502);
    expect(test.body.error).toContain("must be triggerable by anyone");
  });
});

describe("ntfy", () => {
  it("publishes JSON to the server root with the token as a bearer, and masks the topic", async () => {
    const { request, channel, ws } = await testSend({
      type: "ntfy",
      name: "Phone",
      url: "https://ntfy.example",
      topic: "secret-topic_42",
      token: "tk_abcdef",
      priority: 5,
    });
    expect(request.url).toBe("https://ntfy.example/");
    expect(request.headers.authorization).toBe("Bearer tk_abcdef");
    expect(request.redirect).toBe("manual");
    expect(request.body).toEqual({
      topic: "secret-topic_42",
      title: "Test alert from tiny-uptime",
      message: "🔔 Test alert from tiny-uptime — this channel is connected.",
      priority: 5,
    });
    expect(channel).toMatchObject({ host: "ntfy.example", target: "ntfy.example/••••••••" });
    const listed = await call("GET", "/api/v1/channels", ws.apiKey);
    expect(listed.text).not.toContain("secret-topic");
    expect(listed.text).not.toContain("tk_abcdef");

    // An empty token removes it; leaving it out keeps it.
    await call("PATCH", `/api/v1/channels/${channel.id}`, ws.apiKey, { name: "Phone 2" });
    await call("POST", `/api/v1/channels/${channel.id}/test`, ws.apiKey);
    expect(sent.at(-1)!.headers.authorization).toBe("Bearer tk_abcdef");
    await call("PATCH", `/api/v1/channels/${channel.id}`, ws.apiKey, { token: "" });
    await call("POST", `/api/v1/channels/${channel.id}/test`, ws.apiKey);
    expect(sent.at(-1)!.headers.authorization).toBeUndefined();
    expect(sent.at(-1)!.body.topic).toBe("secret-topic_42");
  });

  it("defaults to priority 3 and refuses a redirect", async () => {
    const ws = await setup();
    receivers["https://ntfy.example/"] = () => new Response("", { status: 301, headers: { location: "https://elsewhere.example/" } });
    const channel = (await create(ws.apiKey, { type: "ntfy", name: "Phone", url: "https://ntfy.example/", topic: "t" })).body;
    const test = await call("POST", `/api/v1/channels/${channel.id}/test`, ws.apiKey);
    expect(sent.at(-1)!.body.priority).toBe(3);
    expect(test.status).toBe(502);
    expect(test.body.error).toBe("ntfy.example responded HTTP 301");
  });
});

describe("Lark", () => {
  const url = "https://open.larksuite.com/open-apis/bot/v2/hook/abc-123";

  it("signs the message with HMAC-SHA256 of the timestamp and secret", async () => {
    const { request, channel, ws } = await testSend({ type: "lark", name: "Ops", url, secret: "lark-signing-secret" });
    expect(request.url).toBe(url);
    expect(request.body).toMatchObject({
      msg_type: "text",
      content: { text: "🔔 Test alert from tiny-uptime — this channel is connected." },
      timestamp: expect.stringMatching(/^\d{10}$/),
    });
    expect(Math.abs(Number(request.body.timestamp) - Date.now() / 1000)).toBeLessThan(60);
    // Lark's documented check: base64(HMAC-SHA256(key = "<timestamp>\n<secret>", message = ""))
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(`${request.body.timestamp}\nlark-signing-secret`),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signature = Uint8Array.from(atob(request.body.sign), (c) => c.charCodeAt(0));
    expect(await crypto.subtle.verify("HMAC", key, signature, new Uint8Array())).toBe(true);
    expect(channel).toMatchObject({ host: "open.larksuite.com", target: "open.larksuite.com" });

    // A patch that does not resend the secret keeps signing with it.
    const renamed = await call("PATCH", `/api/v1/channels/${channel.id}`, ws.apiKey, { name: "Ops 2" });
    expect(renamed.text).not.toContain("lark-signing-secret");
    expect(renamed.text).not.toContain("abc-123");
    await call("POST", `/api/v1/channels/${channel.id}/test`, ws.apiKey);
    expect(sent.at(-1)!.body.sign).toBeTypeOf("string");
  });

  it("sends unsigned without a secret, and reads a refusal from the body", async () => {
    const ws = await setup();
    const feishu = "https://open.feishu.cn/open-apis/bot/v2/hook/xyz";
    receivers[feishu] = () => Response.json({ code: 19021, msg: "sign match fail or timestamp is not within one hour from current time" });
    const channel = (await create(ws.apiKey, { type: "lark", name: "Feishu", url: feishu })).body;
    const test = await call("POST", `/api/v1/channels/${channel.id}/test`, ws.apiKey);
    expect(sent.at(-1)!.body).not.toHaveProperty("sign");
    expect(test.status).toBe(502);
    expect(test.body.error).toBe(
      "open.feishu.cn responded HTTP 200 (19021: sign match fail or timestamp is not within one hour from current time)",
    );
  });
});

describe("Telegram", () => {
  it("sends plain text to the chat and never shows the bot token", async () => {
    const { request, channel, ws } = await testSend({ type: "telegram", name: "Me", botToken: TELEGRAM_TOKEN, chatId: "-1001234567890" });
    expect(request.url).toBe(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`);
    expect(request.body).toEqual({
      chat_id: "-1001234567890",
      text: "🔔 Test alert from tiny-uptime — this channel is connected.",
      link_preview_options: { is_disabled: true },
    });
    expect(request.body).not.toHaveProperty("parse_mode");
    expect(channel).toMatchObject({ host: "api.telegram.org", target: "chat -1001234567890" });
    expect(JSON.stringify(channel)).not.toContain("AAEhBP0av18ZZ");

    // A patch without the token keeps it; Telegram's reason for a refusal is shown, the token never is.
    receivers["https://api.telegram.org/"] = () =>
      Response.json({ ok: false, description: "Bad Request: chat not found" }, { status: 400 });
    const patched = await call("PATCH", `/api/v1/channels/${channel.id}`, ws.apiKey, { chatId: "@ops_channel" });
    expect(patched.body.target).toBe("chat @ops_channel");
    const test = await call("POST", `/api/v1/channels/${channel.id}/test`, ws.apiKey);
    expect(sent.at(-1)!.url).toBe(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`);
    expect(test.body.error).toBe("api.telegram.org responded HTTP 400 (Bad Request: chat not found)");
  });
});

describe("PagerDuty", () => {
  it("triggers on open and resolves on recovery with the incident id as dedup key", async () => {
    const ws = await setup();
    const channel = (await create(ws.apiKey, { type: "pagerduty", name: "On call", routingKey: ROUTING_KEY })).body;
    expect(channel).toMatchObject({ host: "events.pagerduty.com", target: "routing key ••••••••cd12" });
    expect(JSON.stringify(channel)).not.toContain(ROUTING_KEY);

    const monitor = await call("POST", "/api/v1/monitors", ws.apiKey, {
      type: "http",
      name: "Site",
      url: "https://site.test/",
      failureThreshold: 1,
      paused: true,
    });
    await runInDurableObject(stub(ws.id), async (object: Workspace, state) => {
      state.storage.sql.exec("UPDATE monitor SET paused = 0, status = 'pending', next_at = 1 WHERE id = ?", monitor.body.id);
      sites["https://site.test/"] = 503;
      await object.alarm();
      state.storage.sql.exec("UPDATE monitor SET next_at = 1");
      sites["https://site.test/"] = 200;
      await object.alarm();
    });
    const incident = (await call("GET", "/api/v1/incidents", ws.apiKey)).body[0];
    const events = sent.filter((s) => s.url === "https://events.pagerduty.com/v2/enqueue").map((s) => s.body);
    expect(events).toEqual([
      {
        routing_key: ROUTING_KEY,
        event_action: "trigger",
        dedup_key: incident.id,
        links: [{ href: `https://uptime.athas.mx/app/incidents?incident=${incident.id}`, text: "View incident" }],
        payload: { summary: "🔴 Site is down — HTTP 503", source: "https://site.test/", severity: "critical" },
      },
      {
        routing_key: ROUTING_KEY,
        event_action: "resolve",
        dedup_key: incident.id,
        links: [{ href: `https://uptime.athas.mx/app/incidents?incident=${incident.id}`, text: "View incident" }],
        payload: { summary: "✅ Site has recovered", source: "https://site.test/", severity: "critical" },
      },
    ]);

    // A test resolves a key that never triggered, so nobody is paged.
    await call("POST", `/api/v1/channels/${channel.id}/test`, ws.apiKey);
    expect(sent.at(-1)!.body).toMatchObject({ event_action: "resolve", dedup_key: expect.stringMatching(/^test-/) });
  });
});

describe("email", () => {
  it("fails clearly when the server has no email binding", async () => {
    const { test, channel } = await testSend({ type: "email", name: "Me", to: "ops@example.com" });
    expect(channel).toMatchObject({ host: "example.com", target: "ops@example.com" });
    expect(test.status).toBe(502);
    expect(test.body.error).toBe("email is not set up on this server: add the EMAIL send_email binding and EMAIL_FROM");
  });
});

describe("patches", () => {
  it("keeps the type and stored secrets, and checks the merged settings", async () => {
    const ws = await setup();
    const channel = (await create(ws.apiKey, { type: "webhook", name: "Hook", url: "https://hooks.example/secret-path" })).body;
    expect((await call("PATCH", `/api/v1/channels/${channel.id}`, ws.apiKey, { type: "slack" })).body.field).toBe("type");
    expect((await call("PATCH", `/api/v1/channels/${channel.id}`, ws.apiKey, { url: "http://169.254.169.254/" })).body.field).toBe("url");
    const paused = await call("PATCH", `/api/v1/channels/${channel.id}`, ws.apiKey, { enabled: false });
    expect(paused.body).toMatchObject({ enabled: false, target: "hooks.example" });
    await call("POST", `/api/v1/channels/${channel.id}/test`, ws.apiKey);
    expect(sent.at(-1)!.url).toBe("https://hooks.example/secret-path");
  });
});

function event(name: string, cause = "HTTP 503"): AlertEvent {
  return {
    kind: "opened",
    incident: { id: "inc1", title: cause, startedAt: Date.UTC(2026, 10, 2, 10, 0), resolvedAt: null },
    monitor: { name, target: "https://site.test/" },
  };
}

describe("message text per channel", () => {
  const base = { id: "c", name: "c", enabled: true, createdAt: 0 };

  it("escapes Slack's mention syntax", async () => {
    await sendSlack({ ...base, type: "slack", url: "https://hooks.slack.example/x" }, event("<!channel> & co"));
    expect(sent.at(-1)!.body.text).toBe("🔴 &lt;!channel&gt; &amp; co is down — HTTP 503");
  });

  it("escapes Markdown in Teams cards", async () => {
    await sendTeams({ ...base, type: "teams", url: "https://workflows.example/x" }, event("*bold* [link](x)"));
    expect(sent.at(-1)!.body.attachments[0].content.body[0].text).toBe("🔴 \\*bold\\* \\[link\\]\\(x\\) is down — HTTP 503");
  });

  it("keeps an ntfy message under 4096 bytes without splitting a character", async () => {
    await sendNtfy({ ...base, type: "ntfy", url: "https://ntfy.example", topic: "t", priority: 3 }, event("Site", "é".repeat(3000)));
    const message: string = sent.at(-1)!.body.message;
    expect(new TextEncoder().encode(message).length).toBeLessThanOrEqual(4000);
    expect(message.endsWith("é…")).toBe(true);
  });

  it("sends email through the binding with the alert as plain text", async () => {
    const mails: unknown[] = [];
    const binding = { send: async (m: unknown) => (mails.push(m), { messageId: "m1" }) } as unknown as SendEmail;
    const result = await sendEmail(
      { EMAIL: binding, EMAIL_FROM: "alerts@uptime.example" },
      { ...base, type: "email", to: "ops@example.com" },
      event("Site"),
    );
    expect(result.isOk()).toBe(true);
    expect(mails).toEqual([
      {
        from: { email: "alerts@uptime.example", name: "tiny-uptime alerts" },
        to: "ops@example.com",
        subject: "🔴 Site is down · tiny-uptime",
        text: [
          "The monitor failed its consecutive checks, so an incident was opened.",
          "",
          "Monitor: Site",
          "Target: https://site.test/",
          "Cause: HTTP 503",
          "Started: 2026-11-02 10:00 UTC",
        ].join("\n"),
      },
    ]);
    const failing = { send: async () => Promise.reject(new Error("sender not verified")) } as unknown as SendEmail;
    const refused = await sendEmail(
      { EMAIL: failing, EMAIL_FROM: "a@b.example" },
      { ...base, type: "email", to: "ops@example.com" },
      event("Site"),
    );
    expect(refused.isErr() && refused.error.message).toBe("email to ops@example.com: sender not verified");
  });
});

describe("links to the incident", () => {
  const base = { id: "c", name: "c", enabled: true, createdAt: 0 };
  const notifier = createNotifier({ APP_URL: "https://up.example/" });
  const link = "https://up.example/app/incidents?incident=inc1";

  it("adds a link in each channel's own form when APP_URL is set", async () => {
    await notifier.send({ ...base, type: "slack", url: "https://hooks.slack.example/x" }, event("Site"));
    expect(sent.at(-1)!.body.text).toBe(`🔴 Site is down — HTTP 503 · <${link}|View incident>`);
    await notifier.send({ ...base, type: "discord", url: "https://discord.example/api/webhooks/1/x" }, event("Site"));
    expect(sent.at(-1)!.body.content).toBe(`🔴 Site is down — HTTP 503\n[View incident](<${link}>)`);
    await notifier.send({ ...base, type: "webhook", url: "https://hooks.example/x" }, event("Site"));
    expect(sent.at(-1)!.body.url).toBe(link);
    await notifier.send({ ...base, type: "pagerduty", routingKey: ROUTING_KEY }, event("Site"));
    expect(sent.at(-1)!.body.links).toEqual([{ href: link, text: "View incident" }]);
  });

  it("sends no link without APP_URL or on a test", async () => {
    await createNotifier({}).send({ ...base, type: "webhook", url: "https://hooks.example/x" }, event("Site"));
    expect(sent.at(-1)!.body.url).toBeUndefined();
    await notifier.send({ ...base, type: "webhook", url: "https://hooks.example/x" }, { ...event("Site"), test: true });
    expect(sent.at(-1)!.body.url).toBeUndefined();
  });
});
