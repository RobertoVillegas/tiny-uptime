import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, type ButtonProps } from "./button";

/** Copies text and confirms with a checkmark for a moment, so nobody clicks three times to be sure. */
export function CopyButton({
  text,
  label = "Copy",
  ...props
}: Omit<ButtonProps, "onClick" | "children"> & { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="sm"
      {...props}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}
