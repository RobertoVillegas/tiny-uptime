# Contributing

Thanks for helping. tiny-uptime stays small on purpose, so a short issue describing what you need is the best first step before a large pull request.

## Before you open a pull request

- `pnpm verify` passes: format, lint, import boundaries, design tokens, types, tests and the CPU and bundle budget.
- `pnpm e2e` passes if you touched the panel.
- New behaviour has a test: domain rules in `packages/core/test`, everything that goes through HTTP or a Durable Object in `apps/worker/test`.
- Layers point inward (see "How it is built" in the README); `pnpm check:boundaries` tells you when they do not.
- The status page stays server-rendered HTML without JavaScript.

## Design tokens

Colors, the type scale and radii live in `packages/ui/src/tokens.ts`, and every surface reads them from there:

- **Panel:** through the generated `packages/ui/src/styles/tokens.css`. After editing the tokens, run `pnpm --filter @tiny-uptime/ui tokens`.
- **Public status page and OAuth pages:** through `tokensCss()`.

Use the named utilities (`text-small`, `bg-surface`, `rounded-control`) rather than values typed by hand. When none fits, add a token. `pnpm check:design` fails on a hand-typed font size, color or radius, on a color literal outside the tokens, and on the plain `cn` import (use `@tiny-uptime/ui/cn`, which knows the token scale). Arbitrary values for layout, such as grid templates or `calc`, are fine.

## Security

Please report vulnerabilities privately through GitHub's "Report a vulnerability" on this repository rather than in an issue.
