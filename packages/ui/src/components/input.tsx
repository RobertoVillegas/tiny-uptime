import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";

/** 16px on phones so iOS does not zoom into the field; 14px from small screens up. */
export const inputClass = cn(
  "h-9 w-full min-w-0 rounded-control border border-border-strong bg-surface px-3 text-base text-foreground sm:text-sm",
  "transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-muted-foreground",
  "hover:border-[color-mix(in_oklch,var(--foreground)_30%,transparent)]",
  "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25",
  "data-[invalid]:border-down data-[invalid]:focus-visible:ring-down/25",
  "disabled:bg-subtle disabled:text-muted-foreground max-sm:h-11",
);

export function Input({ className, ...props }: InputPrimitive.Props) {
  return <InputPrimitive data-slot="input" className={cn(inputClass, className)} {...props} />;
}
