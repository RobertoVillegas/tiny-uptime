import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/** A titled section that folds away, with a one-line summary of what it holds while closed. */
export function Disclosure({
  title,
  summary,
  open,
  onOpenChange,
  children,
}: {
  title: ReactNode;
  summary?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange} className="rounded-control border border-border">
      <Collapsible.Trigger className="group flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left font-medium sm:min-h-0">
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[panel-open]:rotate-90"
          aria-hidden
        />
        {title}
        {summary ? <span className="ml-auto truncate text-[0.8125rem] font-normal text-muted-foreground">{summary}</span> : null}
      </Collapsible.Trigger>
      <Collapsible.Panel className="flex flex-col gap-5 border-t border-border p-3">{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}
