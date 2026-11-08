import { useMutation } from "@tanstack/react-query";
import { Button } from "@tiny-uptime/ui/components/button";
import { CodeInput } from "@tiny-uptime/ui/components/otp";
import { useState } from "react";
import { api, messageOf } from "../../lib/api";

/** The second step of sign-in for users with an authenticator app. */
export function MfaStep({ onDone }: { onDone: () => void | Promise<void> }) {
  const [code, setCode] = useState("");
  const verify = useMutation({ meta: { inlineErrors: true }, mutationFn: () => api.auth.mfa(code), onSuccess: () => onDone() });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) verify.mutate();
      }}
    >
      <CodeInput value={code} onValueChange={setCode} invalid={verify.isError} autoFocus />
      {verify.isError ? (
        <p role="alert" className="text-small text-down">
          {messageOf(verify.error)}
        </p>
      ) : null}
      <Button type="submit" variant="primary" className="w-full" loading={verify.isPending} disabled={code.length !== 6}>
        Verify and continue
      </Button>
    </form>
  );
}
