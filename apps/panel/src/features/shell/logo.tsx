/** The mark: a heartbeat line in a rounded square, plus the name. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <rect width="24" height="24" rx="6" className="fill-primary" />
        <path
          d="M5 12.5h3.2l1.8-4 3 8 2-5.5 1.2 1.5H19"
          fill="none"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-primary-foreground"
        />
      </svg>
      {compact ? null : <span>tiny-uptime</span>}
    </span>
  );
}
