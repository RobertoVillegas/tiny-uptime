import { Field } from "@base-ui/react/field";
import { cn } from "../cn";
import type { ComponentProps } from "react";
import { inputClass } from "./input";

/** A multi-line input that takes its label from the surrounding Field, like Input does. */
export function Textarea({ className, rows = 3, ...props }: Omit<ComponentProps<"textarea">, "ref">) {
  return <Field.Control render={<textarea rows={rows} />} className={cn(inputClass, "h-auto py-2", className)} {...(props as object)} />;
}
