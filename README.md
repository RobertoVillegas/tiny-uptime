# tiny-uptime

An uptime monitor that runs entirely on Cloudflare's free plan and stays far below its 10 ms CPU limit per request.

A Worker serves the public status page, heartbeats, the REST API and sign-in. Each workspace is a Durable Object with its own SQLite database: it stores the monitors, runs their checks from an alarm set to the next one due, and sends alerts. An `AuthStore` Durable Object keeps accounts, passkeys and sessions, and a directory maps status page slugs to workspaces. There is no cron scan, external database, ORM or web framework.

## Layout

```
packages/contracts   API schemas (Valibot) and response types, shared by the worker and every client
packages/client      typed API client, used by the panel and reusable by a mobile app
packages/ui          the panel's components: Base UI, Tailwind 4, cva, tokens in OKLCH
packages/core        domain rules and use cases; no Cloudflare APIs
  domain/            pure rules: monitor state machine, schedule, incidents, roles, TOTP
  application/       use cases, one file per area, depending on ports
  ports/             interfaces the use cases need: repositories, checker, notifier, clock
apps/panel           private panel at /app: React 19, TanStack Router, Query and Form, built by Vite
apps/worker          the Cloudflare side
  adapters/          SQLite repositories, checks (HTTP, sockets, DNS, RDAP, JSON-RPC), alert channels, MCP, passkeys, HTTP routes
  runtime/           Worker entry and Durable Objects: wire adapters to use cases, nothing else
```

Dependencies point inward: `domain` imports nothing, `application` imports `domain` and `ports`, and only `apps/worker` knows about Cloudflare. Use cases return `Result` values from [better-result](https://github.com/dmmulroy/better-result) with tagged errors; `apps/worker/src/adapters/http/respond.ts` is the one place an error becomes an HTTP status. Input is validated with Valibot schemas from `contracts`.

`pnpm check:boundaries` enforces these rules on every import, along with declared dependencies, so a layer cannot quietly reach into another.

The panel is static files served by the Worker's static assets, so it costs no Worker CPU; the public status page stays server-rendered HTML with no JavaScript.

Tests follow the layers: `packages/core/test` checks the domain rules in plain Node, and `apps/worker/test` drives the real Worker and Durable Objects through HTTP, including passkey sign-in with a software authenticator. `pnpm e2e` runs the panel against the real Worker in Chromium, with a virtual authenticator and axe accessibility checks.

## Budget

These are enforced by `pnpm budget` in CI:

|                                          | Budget  | Now    |
| ---------------------------------------- | ------- | ------ |
| Worker bundle (gzip, minified)           | 100 KiB | 48 KiB |
| Startup CPU (local profile, median of 3) | 10 ms   | ~5 ms  |

Measured on Cloudflare with the prototype: 0–1 ms per heartbeat, 1–2 ms per status page, 2–4 ms per round of checks.

## What works

- Workspaces, created by the instance operator, each with its own API keys.
- REST API at `/api/v1` (`Authorization: Bearer tu_…` or `x-api-key`): monitors, hourly stats, incidents, alert channels and API keys.
- Monitors: HTTP (method, headers, body, expected status codes, keyword present or absent), TCP, Minecraft server list ping, heartbeat with a grace period, and the rest of OpenUptime's types:
  - DNS: A, AAAA, CNAME, MX, TXT or NS records through Cloudflare's DNS over HTTPS, optionally matching an expected value exactly or as a substring.
  - PostgreSQL, MySQL/MariaDB and Redis: a protocol handshake (SSLRequest, the server greeting, an inline PING) that proves the server answers, without credentials.
  - WebSocket: the upgrade, and optionally a message that must get a reply.
  - Domain registration expiry through RDAP, down within a number of days of expiring; checked daily by default.
  - MCP servers over Streamable HTTP: initialize and list tools, with optional headers for auth.
  - EVM nodes (`eth_syncing`, optionally `eth_chainId`) and Solana nodes (`getHealth`).
- A monitor is reported down after two failures in a row; a failed check is retried after 20 seconds. Each monitor checks at a fixed offset inside its interval, so monitors spread out instead of firing together.
- Incidents open and resolve with the monitor's status; alerts go to Slack, Discord, Microsoft Teams (Workflow webhook), ntfy, Lark / Feishu, Telegram, PagerDuty (Events API v2), email, or a webhook in OpenUptime's JSON format, with retries. The API never returns a channel's secrets: it shows the host and a masked target, and a patch that does not resend a secret keeps it. Channel URLs must be http(s) and cannot point at private, loopback or internal hosts.
- Email alerts need Cloudflare Email Service: add a `send_email` binding named `EMAIL` and an `EMAIL_FROM` var with a verified sender to `wrangler.jsonc`. Without them, email deliveries fail with that explanation.
- Accounts: sign-up from an invite with a passkey, passkey sign-in, optional TOTP second factor, one-time recovery codes, and owner, editor and viewer roles per workspace. The panel's session cookie works with the REST API alongside `x-workspace-id`.
- Public status page per workspace at `/s/<slug>` (and `/` for `PUBLIC_SLUG`), JSON at `/api/public/<slug>`. Only monitors marked `public` appear.

- Private panel at `/app`: passkey sign-in and sign-up from invites, monitors (create, edit, pause, delete, uptime history), incidents, alert channels of every type with test sends, members and roles, API keys, passkeys, TOTP and recovery codes.

- MCP server at `/api/mcp` (Streamable HTTP, stateless JSON): tools to read and change monitors, incidents, maintenance windows, channels and status pages. Clients sign in with OAuth: the server publishes its metadata (RFC 9728, RFC 8414), accepts dynamic client registration, and asks the signed-in user which workspace and what access to grant (read only, or read and change up to their role). Access tokens last an hour; refresh tokens rotate, and a replayed one revokes the connection. Connected apps are listed, and can be disconnected, on the account page. An API key works too:

  ```sh
  claude mcp add --transport http tiny-uptime https://<host>/api/mcp                                  # OAuth
  claude mcp add --transport http tiny-uptime https://<host>/api/mcp --header "Authorization: Bearer tu_…"
  ```

Next: import from OpenUptime, multi-region checks. The goal is feature parity with OpenUptime.

## Run

Tool versions are pinned in `mise.toml` (Node, pnpm). Tasks run through Turborepo; TypeScript 7 checks types, oxlint and oxfmt lint and format.

```bash
pnpm install
echo 'ADMIN_TOKEN=local-dev-token' > apps/worker/.dev.vars
pnpm dev
pnpm verify      # format, lint, boundaries, typecheck, tests and budget, as CI runs them
```

Deploy with `pnpm deploy`, then set the operator token with `pnpm --filter @tiny-uptime/worker exec wrangler secret put ADMIN_TOKEN`.

Create a workspace; the response carries its first API key, shown once:

```bash
curl -X POST https://<worker>/api/admin/workspaces \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name": "Acme", "slug": "acme"}'
```

Then, with that key:

```bash
curl -X POST https://<worker>/api/v1/monitors -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"type": "http", "name": "Site", "url": "https://example.com/", "intervalSec": 60, "public": true}'
curl -X POST https://<worker>/api/v1/channels -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"type": "webhook", "name": "Phone", "url": "https://example.com/hook"}'
```

Heartbeat monitors return a `heartbeatUrl`; send a GET or POST to it.

## Free plan budget

| Limit (per day)                           | Free plan   | Expected with ~16 monitors           |
| ----------------------------------------- | ----------- | ------------------------------------ |
| Worker requests (shared by the account)   | 100,000     | heartbeats, API calls and page views |
| Durable Object requests (alarms included) | 100,000     | ~7,000–10,000                        |
| SQLite rows written                       | 100,000     | ~15,000–30,000                       |
| Durable Object duration                   | 13,000 GB-s | under 11,000 even if never idle      |

Writes past the free limit fail instead of being billed, so a check writes two rows (the monitor and its hourly rollup) and an API key's last use is written at most once an hour.
