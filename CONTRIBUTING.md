# Contributing

Thanks for helping. tiny-uptime stays small on purpose, so a short issue describing what you need is the best first step before a large pull request.

## Before you open a pull request

- `pnpm verify` passes: format, lint, import boundaries, types, tests and the CPU and bundle budget.
- `pnpm e2e` passes if you touched the panel.
- New behaviour has a test: domain rules in `packages/core/test`, everything that goes through HTTP or a Durable Object in `apps/worker/test`.
- Layers point inward (see "How it is built" in the README); `pnpm check:boundaries` tells you when they do not.
- The status page stays server-rendered HTML without JavaScript.

## Security

Please report vulnerabilities privately through GitHub's "Report a vulnerability" on this repository rather than in an issue.
