# tiny-uptime

An uptime monitor that runs entirely on Cloudflare's free plan and stays far below its 10 ms CPU limit per request.

A Worker serves the public status page, heartbeats and the REST API. Each workspace is a Durable Object with its own SQLite database: it stores the monitors, runs their checks from an alarm set to the next one due, and sends alerts. A second Durable Object, the directory, only maps status page slugs to workspaces. There is no cron scan, external database, ORM or web framework.

## Budget

These are enforced by `pnpm budget` in CI:

| | Budget | Now |
| --- | --- | --- |
| Worker bundle (gzip) | 100 KiB | 14 KiB |
| Startup CPU (local profile, median of 3) | 10 ms | ~0 ms |

Measured on Cloudflare with the prototype: 0–1 ms per heartbeat, 1–2 ms per status page, 2–4 ms per round of checks.

## What works

- Workspaces, created by the instance operator, each with its own API keys.
- REST API at `/api/v1` (`Authorization: Bearer tu_…` or `x-api-key`): monitors, hourly stats, incidents, alert channels and API keys.
- Monitors: HTTP (method, headers, body, expected status codes, keyword present or absent), TCP, Minecraft server list ping, heartbeat with a grace period.
- A monitor is reported down after two failures in a row; a failed check is retried after 20 seconds. Each monitor checks at a fixed offset inside its interval, so monitors spread out instead of firing together.
- Incidents open and resolve with the monitor's status; alerts go to webhook channels in OpenUptime's webhook format, with retries.
- Public status page per workspace at `/s/<slug>` (and `/` for `PUBLIC_SLUG`), JSON at `/api/public/<slug>`. Only monitors marked `public` appear.

Next: the private panel and sign-in, an MCP server, more monitor types and channels, 90-day history on the status page, maintenance windows. The goal is feature parity with OpenUptime.

## Run

```bash
pnpm install
echo 'ADMIN_TOKEN=local-dev-token' > .dev.vars
pnpm dev
pnpm test
pnpm budget
```

Deploy with `pnpm deploy`, then set the operator token with `pnpm exec wrangler secret put ADMIN_TOKEN`.

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

| Limit (per day) | Free plan | Expected with ~16 monitors |
| --- | --- | --- |
| Worker requests (shared by the account) | 100,000 | heartbeats, API calls and page views |
| Durable Object requests (alarms included) | 100,000 | ~7,000–10,000 |
| SQLite rows written | 100,000 | ~15,000–30,000 |
| Durable Object duration | 13,000 GB-s | under 11,000 even if never idle |

Writes past the free limit fail instead of being billed, so a check writes two rows (the monitor and its hourly rollup) and an API key's last use is written at most once an hour.
