import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../cn";
import { useId, type ReactNode } from "react";

/** A switch with its label: clicking the label toggles it. */
export function Switch({
  label,
  description,
  className,
  ...props
}: SwitchPrimitive.Root.Props & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="text-small font-medium">{label}</span>
        {description ? <span className="text-small text-muted-foreground">{description}</span> : null}
      </label>
      <SwitchPrimitive.Root
        id={id}
        className={cn(
          "relative mt-0.5 flex h-5 w-9 shrink-0 rounded-full bg-border-strong p-0.5 transition-colors duration-150 ease-out",
          "data-checked:bg-primary disabled:opacity-50",
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb className="size-4 rounded-full bg-surface shadow-sm transition-transform duration-150 ease-out data-checked:translate-x-4" />
      </SwitchPrimitive.Root>
    </div>
  );
}
