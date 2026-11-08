import { Field as FieldPrimitive } from "@base-ui/react/field";
import { cn } from "../cn";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

type FieldProps = {
  label: ReactNode;
  description?: ReactNode;
  /** Shown under the control with an icon, so the error never relies on color alone. */
  error?: string | undefined;
  children: ReactNode;
  className?: string;
};

/** A labelled control: the label is always visible, never only a placeholder. */
export function Field({ label, description, error, children, className }: FieldProps) {
  return (
    <FieldPrimitive.Root invalid={Boolean(error)} className={cn("flex flex-col gap-1.5", className)}>
      <FieldPrimitive.Label className="text-small font-medium text-foreground">{label}</FieldPrimitive.Label>
      {children}
      {description && !error ? (
        <FieldPrimitive.Description className="text-small text-muted-foreground">{description}</FieldPrimitive.Description>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-small text-down">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </FieldPrimitive.Root>
  );
}

export const FieldControl = FieldPrimitive.Control;
