import { OTPField } from "@base-ui/react/otp-field";
import { cn } from "../cn";

/** A six-digit code from an authenticator app. Pasting a whole code fills every box. */
export function CodeInput({
  value,
  onValueChange,
  invalid,
  autoFocus,
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  id?: string;
}) {
  return (
    <OTPField.Root length={6} value={value} onValueChange={onValueChange} {...(id ? { id } : {})} className="flex gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <OTPField.Input
          key={i}
          autoFocus={autoFocus && i === 0}
          aria-invalid={invalid || undefined}
          className={cn(
            "size-11 rounded-control border border-border-strong bg-surface text-center text-lg font-medium tabular-nums",
            "transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25",
            invalid && "border-down",
          )}
        />
      ))}
    </OTPField.Root>
  );
}
