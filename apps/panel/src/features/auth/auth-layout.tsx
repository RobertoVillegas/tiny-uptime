import type { ReactNode } from "react";
import { Logo } from "../shell/logo";

/** The frame for sign-in pages: the product mark, one card, nothing else to look at. */
export function AuthLayout({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-12">
      <Logo />
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6 sm:p-8">
        <div className="mb-6 flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-balance">{title}</h1>
          {description ? <p className="text-pretty text-muted-foreground">{description}</p> : null}
        </div>
        {children}
      </div>
    </main>
  );
}
