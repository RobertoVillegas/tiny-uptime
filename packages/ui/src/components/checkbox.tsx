import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "cn";
import { Check, Minus } from "lucide-react";
import { useId, type ReactNode } from "react";

/** A checkbox with its label; the whole row toggles it. */
export function Checkbox({
  label,
  description,
  className,
  ...props
}: CheckboxPrimitive.Root.Props & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <CheckboxPrimitive.Root
        id={id}
        aria-labelledby={labelId}
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong bg-surface transition-colors duration-150",
          "data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground",
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator>
          <Check className="size-3" strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <label htmlFor={id} className="flex flex-col gap-0.5 select-none">
        <span id={labelId}>{label}</span>
        {description ? <span className="text-[0.8125rem] text-muted-foreground">{description}</span> : null}
      </label>
    </div>
  );
}

/** A list of checkboxes over a set of values. */
export function CheckboxList<T extends string>({
  value,
  onValueChange,
  options,
}: {
  value: T[];
  onValueChange: (value: T[]) => void;
  options: readonly { value: T; label: ReactNode }[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-control border border-border-strong p-3">
      {options.map((o) => (
        <Checkbox
          key={o.value}
          label={o.label}
          checked={value.includes(o.value)}
          onCheckedChange={(checked) => onValueChange(checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
        />
      ))}
    </div>
  );
}

/** A checkbox without a visible label, such as a row's select box; `aria-label` names it. */
export function Tick({ className, ...props }: CheckboxPrimitive.Root.Props & { "aria-label": string }) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong bg-surface transition-colors duration-150",
        "data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground",
        "data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground",
        "outline-offset-2 max-sm:size-5",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator keepMounted={false}>
        {props.indeterminate ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
