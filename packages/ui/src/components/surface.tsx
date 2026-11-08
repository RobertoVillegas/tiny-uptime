import { cn } from "../cn";
import type { HTMLAttributes, ReactNode } from "react";

/** A bordered section of a page, with an optional header row. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { title?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-card border border-border bg-surface", className)} {...props}>
      {title || actions ? (
        <header className={cn("flex flex-wrap items-center justify-between gap-3 px-5 py-4", children ? "border-b border-border" : "")}>
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
            {description ? <p className="text-small text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Explains why a list is empty and offers the next step. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon ? <div className="text-muted-foreground [&_svg]:size-6">{icon}</div> : null}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="font-medium">{title}</p>
        <p className="text-pretty text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-subtle motion-reduce:animate-none", className)} />;
}
