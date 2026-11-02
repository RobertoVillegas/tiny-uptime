import { Popover } from "@base-ui/react/popover";
import { cn } from "cn";
import type { ReactElement, ReactNode } from "react";

/**
 * Details about a point on a chart: opens on hover with no delay, on focus, and on tap, so it
 * works with a mouse, a keyboard and a phone alike.
 */
export function HoverCard({ trigger, children, className }: { trigger: ReactElement; children: ReactNode; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger openOnHover delay={0} closeDelay={60} render={trigger} />
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={8} className="z-50">
          <Popover.Popup
            className={cn(
              "w-72 origin-[var(--transform-origin)] rounded-control bg-surface-raised p-3 text-[0.8125rem] shadow-raised outline-none",
              "transition-[opacity,scale] duration-100 ease-out data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
              className,
            )}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
