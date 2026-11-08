import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@tiny-uptime/ui/components/button";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { api, messageOf } from "../../lib/api";
import { passkeysAvailable, usePasskey } from "../../lib/passkeys";
import { loginRoute } from "../../router";
import { AuthLayout } from "./auth-layout";
import { MfaStep } from "./mfa-step";

export function LoginPage() {
  const { next } = loginRoute.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<"passkey" | "mfa">("passkey");
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    if (next?.startsWith("/app/") || next?.startsWith("/oauth/authorize?")) window.location.assign(next);
    else await navigate({ to: "/monitors" });
  };

  const signIn = useMutation({
    meta: { inlineErrors: true },
    mutationFn: async () => {
      const { challengeId, challenge } = await api.auth.loginOptions();
      const authentication = await usePasskey(challenge);
      return api.auth.loginComplete(challengeId, authentication as unknown as Record<string, unknown>);
    },
    onMutate: () => setError(null),
    onSuccess: async (result) => (result.stage === "mfa" ? setStage("mfa") : finish()),
    onError: (e) => setError(messageOf(e)),
  });

  if (stage === "mfa") {
    return (
      <AuthLayout title="Enter your code" description="Open your authenticator app and type the 6-digit code for tiny-uptime.">
        <MfaStep onDone={finish} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign in" description="Use the passkey saved on this device or your phone.">
      <div className="flex flex-col gap-4">
        <Button
          variant="primary"
          className="w-full"
          loading={signIn.isPending}
          disabled={!passkeysAvailable()}
          onClick={() => signIn.mutate()}
        >
          <KeyRound />
          Sign in with a passkey
        </Button>
        {!passkeysAvailable() ? (
          <p className="text-small text-down">
            This browser does not support passkeys. Try a current version of Safari, Chrome or Firefox.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-small text-down">
            {error}
          </p>
        ) : null}
        <p className="text-center text-small text-muted-foreground">
          Lost your passkey?{" "}
          <Link to="/recover" className="font-medium text-foreground underline underline-offset-4">
            Use a recovery code
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
