import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A labelled group of controls, like a list of checkboxes: a fieldset whose legend names the
 * group, so each control keeps its own name.
 */
export function FieldGroup({
  legend,
  description,
  error,
  children,
}: {
  legend: ReactNode;
  description?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-small font-medium">{legend}</legend>
      {children}
      {description && !error ? <p className="text-small text-muted-foreground">{description}</p> : null}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-small text-down">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
