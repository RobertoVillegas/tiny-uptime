import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@tiny-uptime/ui/components/button";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input } from "@tiny-uptime/ui/components/input";
import { Skeleton } from "@tiny-uptime/ui/components/surface";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { api, isUnauthorized, messageOf } from "../../lib/api";
import { createPasskey } from "../../lib/passkeys";
import { meQuery } from "../../lib/queries";
import { inviteRoute } from "../../router";
import { RecoveryCodes } from "../account/recovery-codes";
import { AuthLayout } from "./auth-layout";

const ROLE: Record<string, string> = { owner: "an owner", editor: "an editor", viewer: "a viewer" };

/** Accepts an invitation: new people create their account with a passkey, existing users join after signing in. */
export function InvitePage() {
  const { token } = inviteRoute.useSearch();
  const invite = useQuery({ queryKey: ["invite", token], queryFn: () => api.auth.invite(token), retry: false, enabled: token !== "" });

  if (!token || invite.isError) {
    return (
      <AuthLayout
        title="This invite does not work"
        description="It may have expired or been used already. Ask the person who invited you for a new link."
      >
        <Link to="/login" className="text-small font-medium underline underline-offset-4">
          Go to sign in
        </Link>
      </AuthLayout>
    );
  }
  if (!invite.data) {
    return (
      <AuthLayout title="Checking your invite">
        <Skeleton className="h-9 w-full" />
      </AuthLayout>
    );
  }
  const { email, workspaceName, role, existingUser } = invite.data;
  const description = (
    <>
      You were invited to <strong className="font-medium text-foreground">{workspaceName}</strong> as {ROLE[role]}, with {email}.
    </>
  );
  return existingUser ? <JoinWorkspace token={token} description={description} /> : <SignUp token={token} description={description} />;
}

function SignUp({ token, description }: { token: string; description: React.ReactNode }) {
  const [name, setName] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signUp = useMutation({
    meta: { inlineErrors: true },
    mutationFn: async () => {
      const options = await api.auth.inviteOptions(token, name.trim());
      const registration = await createPasskey(options.challenge, options.user);
      return api.auth.inviteComplete({
        token,
        name: name.trim(),
        challengeId: options.challengeId,
        registration: registration as unknown as Record<string, unknown>,
      });
    },
    onSuccess: (result) => setCodes(result.recoveryCodes),
  });

  if (codes) {
    return (
      <AuthLayout
        title="Save your recovery codes"
        description="If you lose your passkey, one of these codes lets you back in. Each works once, and you will not see them again."
      >
        <RecoveryCodes codes={codes} />
        <Button
          variant="primary"
          className="mt-5 w-full"
          onClick={async () => {
            await queryClient.invalidateQueries({ queryKey: ["me"] });
            await navigate({ to: "/monitors" });
          }}
        >
          I saved them, continue
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" description={description}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) signUp.mutate();
        }}
      >
        <Field label="Your name" error={signUp.isError ? messageOf(signUp.error) : undefined}>
          <Input autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={signUp.isPending} disabled={!name.trim()}>
          <KeyRound />
          Create passkey and join
        </Button>
        <p className="text-small text-pretty text-muted-foreground">
          A passkey replaces a password: your device keeps it and unlocks it with Face ID, Touch ID or your screen lock.
        </p>
      </form>
    </AuthLayout>
  );
}

function JoinWorkspace({ token, description }: { token: string; description: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({ ...meQuery, retry: false });
  const accept = useMutation({
    mutationFn: () => api.auth.acceptInvite(token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await navigate({ to: "/monitors" });
    },
  });
  const signedOut = me.isError && isUnauthorized(me.error);
  return (
    <AuthLayout title="Join the workspace" description={description}>
      {signedOut ? (
        <Button variant="primary" className="w-full" render={<Link to="/login" search={{ next: `/app/invite?token=${token}` }} />}>
          Sign in to accept
        </Button>
      ) : (
        <Button variant="primary" className="w-full" loading={accept.isPending || me.isPending} onClick={() => accept.mutate()}>
          Accept invite
        </Button>
      )}
    </AuthLayout>
  );
}
