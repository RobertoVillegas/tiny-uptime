import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLES, type Role } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { CopyButton } from "@tiny-uptime/ui/components/copy-button";
import { ConfirmDialog, Dialog } from "@tiny-uptime/ui/components/dialog";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { api, messageOf } from "../../lib/api";
import { membersQuery } from "../../lib/queries";

const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: { owner: "Owner", editor: "Editor", viewer: "Viewer" }[r] }));
const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including members and API keys.",
  editor: "Creates and changes monitors and alerts.",
  viewer: "Sees monitors and incidents, changes nothing.",
};

export function MembersSection({ workspaceId, canManage, myUserId }: { workspaceId: string; canManage: boolean; myUserId: string }) {
  const members = useQuery(membersQuery(workspaceId));
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: membersQuery(workspaceId).queryKey });
  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: Role }) => api.members.setRole(workspaceId, v.userId, v.role),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (userId: string) => api.members.remove(workspaceId, userId), onSuccess: refresh });

  return (
    <Section title="Members" actions={canManage ? <InviteDialog workspaceId={workspaceId} onInvited={refresh} /> : null}>
      {members.isPending ? (
        <div className="p-5">
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {members.data!.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">
                  {m.name}
                  {m.userId === myUserId ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                </span>
                <span className="truncate text-small text-muted-foreground">{m.email}</span>
              </div>
              {canManage && m.userId !== myUserId ? (
                <>
                  <div className="w-32">
                    <Select
                      label={`Role for ${m.name}`}
                      labelTrigger
                      value={m.role}
                      onValueChange={(role) => setRole.mutate({ userId: m.userId, role })}
                      options={ROLE_OPTIONS}
                    />
                  </div>
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm" className="text-down">
                        Remove
                      </Button>
                    }
                    title={`Remove ${m.name}?`}
                    description="They lose access to this workspace right away. Their account stays."
                    confirmLabel="Remove member"
                    pending={remove.isPending}
                    onConfirm={() => remove.mutateAsync(m.userId)}
                  />
                </>
              ) : (
                <span className="text-small text-muted-foreground capitalize">{m.role}</span>
              )}
            </li>
          ))}
          {members.data!.invites.map((i) => (
            <li key={i.email} className="flex items-center gap-3 px-5 py-3.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium text-muted-foreground">{i.email}</span>
                <span className="text-small text-muted-foreground">Invited as {i.role} · waiting to accept</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function InviteDialog({ workspaceId, onInvited }: { workspaceId: string; onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [link, setLink] = useState<string | null>(null);
  const invite = useMutation({
    meta: { inlineErrors: true },
    mutationFn: () => api.members.invite(workspaceId, email.trim(), role),
    onSuccess: (r) => {
      setLink(r.inviteUrl);
      onInvited();
    },
  });
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setLink(null);
      setEmail("");
      invite.reset();
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      trigger={
        <Button size="sm">
          <UserPlus />
          Invite
        </Button>
      }
      title={link ? "Send this link" : "Invite someone"}
      description={link ? "tiny-uptime does not send email. Share the link with them; it works once and expires in 7 days." : undefined}
    >
      {link ? (
        <div className="flex flex-col gap-4">
          <code className="rounded-control bg-subtle px-3 py-2.5 font-mono text-small break-all">{link}</code>
          <div className="flex justify-end gap-2">
            <CopyButton text={link} label="Copy link" />
            <Button variant="primary" size="sm" onClick={() => close(false)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <Field label="Email" error={invite.isError ? messageOf(invite.error) : undefined}>
            <Input type="email" autoFocus autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Role" description={ROLE_HELP[role]}>
            <Select label="Role" value={role} onValueChange={setRole} options={ROLE_OPTIONS} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={invite.isPending} disabled={!email.trim()}>
              Create invite link
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
