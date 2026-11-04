# tiny-uptime

Uptime monitoring and status pages that run entirely on Cloudflare's free plan: one Worker, Durable Objects with SQLite, no external database.

![The monitors list, with each monitor's last 24 hours and the details of one hour](docs/images/panel-monitors.png)

## Why another uptime monitor

[Athas](https://athas.mx) ran [OpenUptime](https://github.com/becoolme/openuptime) on Cloudflare Workers, with Postgres on Supabase reached through Hyperdrive. It is a good product, and most of what tiny-uptime does was learned from it. Two things did not fit how we wanted to run it:

- **The database was a second service to keep alive.** A monitor has one job, to be up when other things are down, and ours depended on Supabase and on Hyperdrive's daily query limit, which the free plan kept running into.
- **We wanted something small that is ours.** A codebase one person can read end to end, that costs nothing to run for a few dozen monitors, and that we can change the day we need something.

So tiny-uptime keeps everything inside Cloudflare. Each workspace is a Durable Object with its own SQLite database that stores its monitors, runs their checks from an alarm and sends the alerts. There is no cron scan, queue, ORM or web framework, and every request stays far below the free plan's 10 ms of CPU.

OpenUptime is the reference for features. tiny-uptime sends alerts in OpenUptime's webhook format, words them the same way and names fields the same where it can, and imports an OpenUptime project's monitors with one API key. We also sent a few performance fixes upstream ([#18](https://github.com/becoolme/openuptime/pull/18)–[#22](https://github.com/becoolme/openuptime/pull/22)). If you want Postgres, teams with projects, an iOS app or a hosted service, use OpenUptime.

## What it does

**Monitoring**

- HTTP with method, headers, body, expected status codes, a keyword present or absent, and [JSON fields](#json-checks) that must hold. Redirects are followed by hand, keeping the cookies each hop sets.
- TCP, DNS records, WebSocket, heartbeats for cron jobs, PostgreSQL, MySQL and Redis handshakes, domain registration expiry, MCP servers, EVM and Solana nodes, and Minecraft servers.
- [Checks from several regions](#multi-region-checks): a run fails only when most of them fail.
- Down after two failures in a row, slow-response thresholds, consecutive successes before recovery, and dependencies so a downstream outage does not page you twice.
- Check now from the panel, the API or MCP; bulk pause, resume, delete and alert routing; tags, sorting, and a chart of the last 24 hours in every row.

**Incidents and status pages**

- Incidents open and resolve with each monitor. You acknowledge them, post public or internal updates, and declare your own for things no monitor sees.
- Maintenance windows, one-off or recurring.
- Public status pages, server-rendered with no JavaScript: groups of monitors, English or Spanish, days cut at the page's midnight and times shown in the visitor's time zone, 24 hours to 90 days of bars, a bar per day that opens its incidents, RSS, JSON, a status badge, a custom domain, and a history reset that deletes nothing.

![A public status page with one day opened](docs/images/status-page.png)

**Alerts**

- Slack, Discord, Microsoft Teams, Telegram, ntfy, Lark / Feishu, PagerDuty, email and webhooks, with retries. Each alert links to the incident in the panel.
- Reminders while nobody acknowledges an incident, and escalation to other channels.

**Accounts and automation**

- Workspaces with owners, editors and viewers. Sign-in with passkeys, optional TOTP, and one-time recovery codes.
- A REST API with API keys, an [MCP server](#mcp) with OAuth so an agent can manage monitors, incidents and status pages, and JSON import and export.

## Deploy

You need a Cloudflare account and [mise](https://mise.jdx.dev) (or the Node and pnpm versions in `mise.toml`).

```bash
git clone https://github.com/RobertoVillegas/tiny-uptime.git && cd tiny-uptime
mise install && pnpm install
pnpm --filter @tiny-uptime/worker exec wrangler login
```

Edit `apps/worker/wrangler.jsonc`, which holds Athas's deployment:

- `routes`: your hostname with `"custom_domain": true`, or remove it to stay on `*.workers.dev`.
- `vars.APP_URL`: the address you will open the panel at. Alerts link to incidents there.
- `vars.PUBLIC_SLUG`: the status page served at `/`, or remove it.

Pick the hostname before you sign up: a passkey belongs to the domain it was created on.

```bash
pnpm deploy
pnpm --filter @tiny-uptime/worker exec wrangler secret put ADMIN_TOKEN   # any long random string
```

Create a workspace and invite yourself as its owner:

```bash
curl -X POST https://<host>/api/admin/workspaces -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"name": "Acme", "slug": "acme"}'
curl -X POST https://<host>/api/admin/invites -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"workspaceId": "<id from above>", "email": "you@example.com"}'
```

Open the `inviteUrl` it returns, create your passkey, and save the recovery codes. Everything else happens in the panel at `/app`. The first response also carries an API key, shown once, for the REST API.

Email alerts need [Cloudflare Email Service](https://developers.cloudflare.com/email-service/): add a `send_email` binding named `EMAIL` and an `EMAIL_FROM` var with a verified sender.

## Use it

### REST API

`/api/v1` takes `Authorization: Bearer tu_…` or `x-api-key`:

```bash
curl -X POST https://<host>/api/v1/monitors -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"type": "http", "name": "Site", "url": "https://example.com/", "intervalSec": 60}'
curl -X POST https://<host>/api/v1/monitors/<id>/check -H "Authorization: Bearer $KEY"
```

Heartbeat monitors return a `heartbeatUrl`; send a GET or POST to it from your job. The panel's session cookie also works with the API, alongside `x-workspace-id`.

### JSON checks

`jsonAssertions` compare fields of a JSON body. Each one takes a path such as `$.data.items[0].state` or `$["odd key"]`, an operation (`equals`, `not_equals`, `contains`, `exists`, `not_exists`, `greater_than` or `less_than`), and a value. Paths are parsed by hand, never evaluated. In the panel you type one per line, for example `$.status == ok`.

### Status pages

Pages live at `/s/<slug>`, with JSON at `/api/public/<slug>`, RSS at `/s/<slug>/rss` and a badge at `/s/<slug>/badge.svg`. `?days=` picks the range (1, 7, 14, 30, 45 or 90), and `?day=2026-11-02` or `?days=1&hour=2026-11-03T14` opens one bar. A page on a custom domain serves all of these at its root.

### MCP

`/mcp` is an MCP server (Streamable HTTP). Clients sign in with OAuth: the server publishes its metadata, accepts dynamic client registration, and asks you which workspace and what access to grant. Connected apps can be disconnected from the account page. An API key works too.

```sh
claude mcp add --transport http tiny-uptime https://<host>/mcp
claude mcp add --transport http tiny-uptime https://<host>/mcp --header "Authorization: Bearer tu_…"
```

### Moving from OpenUptime

`POST /api/v1/monitors/import/openuptime` (or **Import monitors** in the panel) copies the monitors of an OpenUptime project with one of its API keys, which is used for that request and not stored. Monitors already here are skipped, dependencies and regions are carried over, and each row says what did not. Imported heartbeats start paused until their sender points here. Point your webhook receivers at tiny-uptime unchanged: the payload is the same.

## Multi-region checks

A monitor with `regions` (any of `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`) is checked from each of them at once instead of from the workspace's own location. A `Probe` Durable Object per region runs the same checks as the workspace and returns the outcome over RPC; it keeps no state. Heartbeats and domain expiry take no regions, since where they are checked from changes nothing.

- The run fails when a strict majority of the regions that answered failed, so one location's bad route opens no incident. A probe that throws or does not answer within the monitor's timeout plus 5 seconds is left out of the vote; if none answers, the monitor is checked from the workspace, as without regions.
- Each run records one check in the history, whatever the number of regions, so uptime and stats mean the same as before. Its latency is the median of the regions on the winning side, and its detail says who saw what: `HTTP 503 from weur, apac; up from enam`. An incident's cause is that detail.
- Probes are placed with a [location hint](https://developers.cloudflare.com/durable-objects/reference/data-location/), which Cloudflare honours only when `get()` first creates the object, and only as best effort: the probe lands in a data center near the region and stays there. South America, Africa and the Middle East are not offered because Durable Objects hinted there are created in a nearby region instead.

Each region costs one Durable Object request per check: a monitor every `intervalSec` seconds in `n` regions adds `n × 86,400 / intervalSec` requests a day, plus one per region for every 20-second retry while a failure or recovery is being confirmed. One monitor every minute in three regions adds 4,320 a day; every five minutes, 864. Twenty one-minute monitors in three regions, or a hundred five-minute ones, add 86,400: most of the free plan's 100,000 a day. Probe duration is billed only while a check runs (about 0.04 GB-s for a check of 300 ms), far below the daily 13,000 GB-s.

## How it is built

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

`pnpm budget` enforces these in CI:

|                                          | Budget  | Now    |
| ---------------------------------------- | ------- | ------ |
| Worker bundle (gzip, minified)           | 100 KiB | 78 KiB |
| Startup CPU (local profile, median of 5) | 10 ms   | ~6 ms  |

Measured on Cloudflare: 0–1 ms of CPU per heartbeat, 1–2 ms per status page, 2–4 ms per round of checks.

## Free plan budget

| Limit (per day)                           | Free plan   | Expected with ~16 monitors           |
| ----------------------------------------- | ----------- | ------------------------------------ |
| Worker requests (shared by the account)   | 100,000     | heartbeats, API calls and page views |
| Durable Object requests (alarms included) | 100,000     | ~7,000–10,000                        |
| SQLite rows written                       | 100,000     | ~15,000–30,000                       |
| Durable Object duration                   | 13,000 GB-s | under 11,000 even if never idle      |

Writes past the free limit fail instead of being billed, so a check writes three rows (the monitor, its hourly rollup and its daily rollup) and an API key's last use is written at most once an hour.

## Develop

```bash
echo 'ADMIN_TOKEN=local-dev-token' > apps/worker/.dev.vars
pnpm dev                                    # the Worker on http://localhost:8787
pnpm --filter @tiny-uptime/panel dev        # the panel with hot reload on http://127.0.0.1:5173/app/
pnpm verify      # format, lint, boundaries, typecheck, tests and budget, as CI runs them
pnpm e2e         # the panel against the real Worker in Chromium; E2E_PORT picks the port
```

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). OpenUptime, which inspired it, is MIT too.
