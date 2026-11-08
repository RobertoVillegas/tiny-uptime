import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@tiny-uptime/ui/components/button";
import { ConfirmDialog, Dialog } from "@tiny-uptime/ui/components/dialog";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { CodeInput } from "@tiny-uptime/ui/components/otp";
import { Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { notify } from "@tiny-uptime/ui/components/toast";
import { KeyRound, Plug, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api, messageOf } from "../../lib/api";
import { CLOCKS, storeClock, storedClock, type Clock } from "../../lib/clock";
import { timeAgo } from "../../lib/format";
import { createPasskey } from "../../lib/passkeys";
import { meQuery } from "../../lib/queries";
import { PageHeader } from "../shell/page-header";
import { QrCode } from "./qr-code";
import { RecoveryCodes } from "./recovery-codes";

export function AccountPage() {
  const me = useQuery(meQuery);
  if (!me.data) return <Skeleton className="h-40 w-full" />;
  return (
    <>
      <PageHeader title="Account and security" description={`${me.data.name} · ${me.data.email}`} />
      <div className="flex flex-col gap-6">
        <PasskeysSection />
        <TotpSection enabled={me.data.totpEnabled} />
        <RecoverySection left={me.data.recoveryCodesLeft} />
        <ConnectedAppsSection />
        <SessionsSection />
        <PreferencesSection />
      </div>
    </>
  );
}

function useRefreshMe() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
}

function PasskeysSection() {
  const me = useQuery(meQuery);
  const refresh = useRefreshMe();
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const add = useMutation({
    meta: { inlineErrors: true },
    mutationFn: async () => {
      const options = await api.auth.passkeyOptions();
      const registration = await createPasskey(options.challenge, options.user);
      return api.auth.addPasskey({
        challengeId: options.challengeId,
        registration: registration,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
    },
    onSuccess: async () => {
      await refresh();
      setAdding(false);
      setLabel("");
      notify("Passkey added", { type: "success" });
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.auth.removePasskey(id), onSuccess: refresh });
  const passkeys = me.data?.passkeys ?? [];

  return (
    <Section
      id="passkeys"
      title="Passkeys"
      description="Add one per device you use, so losing a phone does not lock you out."
      actions={
        <Dialog
          open={adding}
          onOpenChange={setAdding}
          trigger={
            <Button size="sm">
              <Plus />
              Add passkey
            </Button>
          }
          title="Add a passkey"
          description="Your browser asks where to save it: this device, your phone, or a password manager."
        >
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Field label="Name" description="Optional, to tell your passkeys apart." error={add.isError ? messageOf(add.error) : undefined}>
              <Input autoFocus placeholder="Work laptop" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={add.isPending}>
                <KeyRound />
                Create passkey
              </Button>
            </div>
          </form>
        </Dialog>
      }
    >
      <ul className="divide-y divide-border">
        {passkeys.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-5 py-3.5">
            <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">{p.name}</span>
              <span className="text-small text-muted-foreground">
                {p.lastUsedAt ? `Last used ${timeAgo(p.lastUsedAt)}` : `Added ${timeAgo(p.createdAt)}`}
              </span>
            </div>
            {passkeys.length > 1 ? (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm" className="text-down">
                    Remove
                  </Button>
                }
                title={`Remove ${p.name}?`}
                description="You will not be able to sign in with it anymore."
                confirmLabel="Remove passkey"
                pending={remove.isPending}
                onConfirm={() => remove.mutateAsync(p.id)}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function TotpSection({ enabled }: { enabled: boolean }) {
  const refresh = useRefreshMe();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [disabling, setDisabling] = useState(false);
  const start = useMutation({ mutationFn: () => api.auth.totpSetup(), onSuccess: setSetup });
  const confirm = useMutation({
    meta: { inlineErrors: true },
    mutationFn: () => api.auth.totpConfirm(code),
    onSuccess: async () => {
      await refresh();
      setSetup(null);
      setCode("");
      notify("Two-step verification is on", { description: "You will be asked for a code after your passkey.", type: "success" });
    },
  });
  const disable = useMutation({
    meta: { inlineErrors: true },
    mutationFn: () => api.auth.totpDisable(code),
    onSuccess: async () => {
      await refresh();
      setDisabling(false);
      setCode("");
      notify("Two-step verification is off");
    },
  });

  return (
    <Section
      title="Two-step verification"
      description={
        enabled
          ? "On: sign-in asks for a code from your authenticator app after the passkey."
          : "Off. Add a code from an authenticator app as a second step after your passkey."
      }
      actions={
        enabled ? (
          <Button size="sm" onClick={() => setDisabling(true)}>
            Turn off
          </Button>
        ) : (
          <Button size="sm" loading={start.isPending} onClick={() => start.mutate()}>
            <ShieldCheck />
            Set up
          </Button>
        )
      }
    >
      <Dialog
        open={setup !== null}
        onOpenChange={(o) => !o && setSetup(null)}
        title="Set up your authenticator"
        description="Scan the code with 1Password, Google Authenticator or any TOTP app, then type the 6 digits it shows."
      >
        {setup ? (
          <form
            className="flex flex-col items-start gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) confirm.mutate();
            }}
          >
            <div className="flex flex-wrap items-center gap-5">
              <QrCode value={setup.uri} label="QR code for your authenticator app" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-small text-muted-foreground">Or enter this key</span>
                <code className="font-mono text-small break-all">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
              </div>
            </div>
            <CodeInput value={code} onValueChange={setCode} invalid={confirm.isError} />
            {confirm.isError ? <p className="text-small text-down">{messageOf(confirm.error)}</p> : null}
            <Button type="submit" variant="primary" loading={confirm.isPending} disabled={code.length !== 6}>
              Turn on
            </Button>
          </form>
        ) : null}
      </Dialog>
      <Dialog
        open={disabling}
        onOpenChange={setDisabling}
        title="Turn off two-step verification"
        description="Type a current code from your authenticator app to confirm it is you."
      >
        <form
          className="flex flex-col items-start gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) disable.mutate();
          }}
        >
          <CodeInput value={code} onValueChange={setCode} invalid={disable.isError} autoFocus />
          {disable.isError ? <p className="text-small text-down">{messageOf(disable.error)}</p> : null}
          <Button type="submit" variant="danger" loading={disable.isPending} disabled={code.length !== 6}>
            Turn off
          </Button>
        </form>
      </Dialog>
    </Section>
  );
}

function RecoverySection({ left }: { left: number }) {
  const refresh = useRefreshMe();
  const [codes, setCodes] = useState<string[] | null>(null);
  const issue = useMutation({ mutationFn: () => api.auth.recoveryCodes(), onSuccess: async (r) => (setCodes(r.codes), refresh()) });
  return (
    <Section
      title="Recovery codes"
      description={
        left > 0
          ? `${left} unused. Each one signs you in once if you lose every passkey.`
          : "None left. Create new ones now, or you could be locked out."
      }
      actions={
        <ConfirmDialog
          trigger={<Button size="sm">Create new codes</Button>}
          title="Replace your recovery codes?"
          description="The codes you have now stop working."
          confirmLabel="Replace codes"
          pending={issue.isPending}
          onConfirm={() => issue.mutateAsync()}
        />
      }
    >
      <Dialog
        open={codes !== null}
        onOpenChange={(o) => !o && setCodes(null)}
        title="Save your new recovery codes"
        description="You will not see them again. The old codes no longer work."
      >
        {codes ? <RecoveryCodes codes={codes} /> : null}
      </Dialog>
    </Section>
  );
}

function SessionsSection() {
  const end = useMutation({
    mutationFn: () => api.auth.endOtherSessions(),
    onSuccess: () => notify("Signed out everywhere else", { type: "success" }),
  });
  return (
    <Section
      title="Sessions"
      description="Signed in on another computer you no longer use? End every session except this one."
      actions={
        <ConfirmDialog
          trigger={<Button size="sm">Sign out other sessions</Button>}
          title="Sign out everywhere else?"
          description="Other browsers will have to sign in again. This one stays signed in."
          confirmLabel="Sign out others"
          pending={end.isPending}
          onConfirm={() => end.mutateAsync()}
        />
      }
    />
  );
}

function ConnectedAppsSection() {
  const apps = useQuery({ queryKey: ["connected-apps"], queryFn: () => api.auth.connectedApps() });
  const queryClient = useQueryClient();
  const disconnect = useMutation({
    mutationFn: (id: string) => api.auth.disconnectApp(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["connected-apps"] });
      notify("App disconnected", { type: "success" });
    },
  });
  const list = apps.data ?? [];
  return (
    <Section
      title="Connected apps"
      description={
        list.length
          ? "MCP clients you signed in to tiny-uptime. Disconnecting ends their access at once."
          : "MCP clients you sign in with OAuth show up here, at /mcp on this site."
      }
    >
      {list.length ? (
        <ul className="divide-y divide-border">
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-3.5">
              <Plug className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{a.clientName}</span>
                <span className="text-small text-muted-foreground">
                  {a.workspaceName} · {a.scopes.includes("mcp:write") ? "Read and change" : "Read only"} ·{" "}
                  {a.lastUsedAt ? `Used ${timeAgo(a.lastUsedAt)}` : `Connected ${timeAgo(a.createdAt)}`}
                </span>
              </div>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm" className="text-down">
                    Disconnect
                  </Button>
                }
                title={`Disconnect ${a.clientName}?`}
                description="It loses access right away and has to sign in again to come back."
                confirmLabel="Disconnect"
                pending={disconnect.isPending}
                onConfirm={() => disconnect.mutateAsync(a.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function PreferencesSection() {
  const [clock, setClock] = useState<Clock>(storedClock);
  return (
    <Section id="preferences" title="Preferences" description="Kept in this browser.">
      <Field label="Clock" description="How times show across the panel.">
        <div className="w-56">
          <Select
            label="Clock"
            value={clock}
            onValueChange={(next) => {
              storeClock(next);
              setClock(next);
            }}
            options={CLOCKS}
          />
        </div>
      </Field>
    </Section>
  );
}
