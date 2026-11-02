import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "cn";
import { Check, ChevronsUpDown } from "lucide-react";
import { inputClass } from "./input";

type Option<T extends string> = { value: T; label: string };

/** A native-feeling select over Base UI, listing labelled options. */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  id,
  disabled,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly Option<T>[];
  id?: string;
  disabled?: boolean;
}) {
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(v) => v !== null && onValueChange(v as T)}
      {...(disabled !== undefined ? { disabled } : {})}
      items={options as Option<T>[]}
    >
      <SelectPrimitive.Trigger {...(id ? { id } : {})} className={cn(inputClass, "flex items-center justify-between gap-2 text-left")}>
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={4} className="z-50" alignItemWithTrigger={false}>
          <SelectPrimitive.Popup
            className={cn(
              "min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-control bg-surface-raised p-1 shadow-raised outline-none",
              "transition-[opacity,scale] duration-150 ease-out data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            )}
          >
            <SelectPrimitive.List>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="flex h-8 cursor-default items-center justify-between gap-3 rounded-[calc(var(--radius-control)-0.25rem)] px-2 text-sm outline-none select-none data-[highlighted]:bg-subtle max-sm:h-11"
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <Check className="size-3.5" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
