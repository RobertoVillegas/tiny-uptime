/**
 * The design tokens, the one place colors, type sizes and radii are defined. The panel reads them
 * through `styles/tokens.css` (generated from this file by `pnpm --filter @tiny-uptime/ui tokens`),
 * the public status page through `tokensCss()`, so the two surfaces cannot drift apart.
 *
 * Colors are OKLCH. Neutrals carry a slight cool hue so they agree with the blue focus ring. The
 * primary action is ink, not a brand color, so it never competes with status colors: green, red
 * and amber only ever mean up, down and pending.
 */

type Scheme = Record<ColorToken, string>;

export type ColorToken =
  | "background"
  | "surface"
  | "surface-raised"
  | "foreground"
  | "muted-foreground"
  | "subtle"
  | "border"
  | "border-strong"
  | "border-hover"
  | "primary"
  | "primary-hover"
  | "primary-foreground"
  | "ring"
  | "danger"
  | "danger-hover"
  | "danger-foreground"
  | "up"
  | "down"
  | "pending"
  | "pending-foreground"
  | "paused"
  | "info"
  | "empty"
  | "shadow-raised";

const light: Scheme = {
  background: "oklch(0.985 0.002 255)",
  surface: "oklch(1 0 0)",
  "surface-raised": "oklch(1 0 0)",
  foreground: "oklch(0.22 0.012 255)",
  "muted-foreground": "oklch(0.5 0.014 255)",
  subtle: "oklch(0.96 0.004 255)",
  border: "oklch(0.22 0.012 255 / 0.1)",
  "border-strong": "oklch(0.22 0.012 255 / 0.18)",
  "border-hover": "color-mix(in oklch, var(--foreground) 30%, transparent)",
  primary: "oklch(0.22 0.012 255)",
  "primary-hover": "color-mix(in oklch, var(--primary) 88%, var(--background))",
  "primary-foreground": "oklch(0.99 0 0)",
  ring: "oklch(0.6 0.17 255)",
  danger: "oklch(0.55 0.2 25)",
  "danger-hover": "color-mix(in oklch, var(--danger) 88%, black)",
  "danger-foreground": "oklch(0.99 0 0)",
  up: "oklch(0.63 0.15 150)",
  down: "oklch(0.58 0.2 25)",
  pending: "oklch(0.74 0.14 75)",
  /** Amber dark enough to read as text on the background, for warnings in prose. */
  "pending-foreground": "oklch(0.55 0.13 75)",
  paused: "oklch(0.7 0.01 255)",
  /** Maintenance and other notices that are neither good nor bad. */
  info: "oklch(0.6 0.15 255)",
  /** A bar with no checks in it. */
  empty: "oklch(0.93 0.005 255)",
  "shadow-raised": "0 1px 1px oklch(0 0 0 / 0.04), 0 4px 8px -2px oklch(0 0 0 / 0.06), 0 16px 32px -8px oklch(0 0 0 / 0.1)",
};

const dark: Scheme = {
  ...light,
  background: "oklch(0.17 0.006 255)",
  surface: "oklch(0.205 0.007 255)",
  "surface-raised": "oklch(0.24 0.008 255)",
  foreground: "oklch(0.95 0.004 255)",
  "muted-foreground": "oklch(0.7 0.012 255)",
  subtle: "oklch(0.24 0.008 255)",
  border: "oklch(0.29 0.008 255)",
  "border-strong": "oklch(0.36 0.009 255)",
  primary: "oklch(0.95 0.004 255)",
  "primary-foreground": "oklch(0.2 0.008 255)",
  ring: "oklch(0.68 0.14 255)",
  danger: "oklch(0.62 0.17 25)",
  up: "oklch(0.7 0.12 150)",
  down: "oklch(0.65 0.16 25)",
  pending: "oklch(0.78 0.11 75)",
  "pending-foreground": "oklch(0.78 0.11 75)",
  paused: "oklch(0.55 0.01 255)",
  info: "oklch(0.68 0.12 255)",
  empty: "oklch(0.27 0.008 255)",
  "shadow-raised": "0 0 0 1px var(--border), 0 16px 32px -8px oklch(0 0 0 / 0.5)",
};

export const COLORS = { light, dark } as const;

/**
 * The type scale beside Tailwind's own. Body text is 0.875rem; `small` is secondary text (meta lines, labels, table cells)
 * and `caption` the smallest, for axis labels and tooltips. Sizes leave line height to the parent.
 */
export const TEXT = { caption: "0.75rem", small: "0.8125rem" } as const;

/** Corner radii: `control` for inputs and buttons, `inner` for items inside one, `card` for surfaces. */
export const RADIUS = { inner: "0.25rem", control: "0.5rem", card: "0.75rem" } as const;

const vars = (scheme: Scheme) =>
  Object.entries(scheme)
    .map(([name, value]) => `--${name}:${value}`)
    .join(";");

/**
 * The colors as custom properties on `:root`, light by default, dark when the system asks for it
 * unless the page pins `data-theme="light"`, and dark whenever it pins `data-theme="dark"`.
 */
export function tokensCss(): string {
  return [
    `:root{color-scheme:light;${vars(light)}}`,
    `@media (prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;${vars(dark)}}}`,
    `:root[data-theme=dark]{color-scheme:dark;${vars(dark)}}`,
  ].join("\n");
}
