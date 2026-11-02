import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { LoaderCircle } from "lucide-react";

export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
    "disabled:pointer-events-none disabled:text-muted-foreground data-[loading]:pointer-events-none",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary)_88%,var(--background))] disabled:bg-subtle",
        secondary: "border border-border-strong bg-surface text-foreground hover:bg-subtle",
        ghost: "text-foreground hover:bg-subtle",
        danger: "bg-danger text-danger-foreground hover:bg-[color-mix(in_oklch,var(--danger)_88%,black)] disabled:bg-subtle",
      },
      size: {
        sm: "h-8 px-3 text-[0.8125rem]",
        md: "h-9 px-3.5 text-sm max-sm:h-11",
        icon: "size-9 max-sm:size-11",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & { loading?: boolean };

/** Buttons keep their width while loading: the label stays, a spinner joins it. */
export function Button({ className, variant, size, loading = false, children, disabled, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      focusableWhenDisabled={loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
      {children}
    </ButtonPrimitive>
  );
}
