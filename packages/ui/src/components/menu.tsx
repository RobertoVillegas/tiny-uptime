import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "cn";
import type { ReactElement, ReactNode } from "react";

export type MenuAction = { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean } | "separator";

/** A dropdown of actions, opening from its trigger. */
export function Menu({ trigger, actions, align = "end" }: { trigger: ReactElement; actions: MenuAction[]; align?: "start" | "end" }) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger render={trigger} />
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner sideOffset={6} align={align} className="z-50">
          <MenuPrimitive.Popup
            className={cn(
              "min-w-44 origin-[var(--transform-origin)] rounded-control bg-surface-raised p-1 shadow-raised outline-none",
              "transition-[opacity,scale] duration-150 ease-out data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              "data-[ending-style]:opacity-0 data-[ending-style]:ease-in",
            )}
          >
            {actions.map((action, i) =>
              action === "separator" ? (
                <MenuPrimitive.Separator key={`sep-${i}`} className="my-1 h-px bg-border" />
              ) : (
                <MenuPrimitive.Item
                  key={action.label}
                  onClick={action.onClick}
                  {...(action.disabled !== undefined ? { disabled: action.disabled } : {})}
                  className={cn(
                    "flex h-8 cursor-default items-center gap-2 rounded-[calc(var(--radius-control)-0.25rem)] px-2 text-sm outline-none select-none max-sm:h-11",
                    "data-[highlighted]:bg-subtle data-[disabled]:text-muted-foreground [&_svg]:size-4",
                    action.danger && "text-down",
                  )}
                >
                  {action.icon}
                  {action.label}
                </MenuPrimitive.Item>
              ),
            )}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
