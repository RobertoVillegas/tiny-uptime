import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreatedApiKey } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { CopyButton } from "@tiny-uptime/ui/components/copy-button";
import { ConfirmDialog, Dialog } from "@tiny-uptime/ui/components/dialog";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input } from "@tiny-uptime/ui/components/input";
import { EmptyState, Section } from "@tiny-uptime/ui/components/surface";
import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { api, messageOf } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { apiKeysQuery } from "../../lib/queries";

export function ApiKeysSection() {
  const keys = useQuery(apiKeysQuery());
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: apiKeysQuery().queryKey });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const create = useMutation({
    meta: { inlineErrors: true },
    mutationFn: () => api.apiKeys.create(name.trim()),
    onSuccess: (key) => (setCreated(key), refresh()),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.apiKeys.remove(id), onSuccess: refresh });

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setCreated(null);
      setName("");
      create.reset();
    }
  };

  return (
    <Section
      title="API keys"
      description="For scripts, the MCP server and other tools. A key acts with full access to this workspace."
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus />
          New key
        </Button>
      }
    >
      <Dialog
        open={open}
        onOpenChange={close}
        title={created ? "Copy your key now" : "New API key"}
        description={created ? "This is the only time it is shown. Store it somewhere safe." : undefined}
      >
        {created ? (
          <div className="flex flex-col gap-4">
            <code className="rounded-control bg-subtle px-3 py-2.5 font-mono text-small break-all">{created.key}</code>
            <div className="flex justify-end gap-2">
              <CopyButton text={created.key} label="Copy key" />
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
              if (name.trim()) create.mutate();
            }}
          >
            <Field
              label="Name"
              description="Say where it is used, so you know which to revoke later."
              error={create.isError ? messageOf(create.error) : undefined}
            >
              <Input autoFocus placeholder="Claude Code" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()}>
                Create key
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      {(keys.data ?? []).length === 0 && !keys.isPending ? (
        <EmptyState icon={<KeyRound />} title="No API keys" description="Create one to call the API from scripts or connect an agent." />
      ) : (
        <ul className="divide-y divide-border">
          {(keys.data ?? []).map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{k.name}</span>
                <span className="text-small text-muted-foreground tabular-nums">
                  tu_…{k.hint.replace("…", "")} · {k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : "never used"}
                </span>
              </div>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm" className="text-down">
                    Revoke
                  </Button>
                }
                title={`Revoke ${k.name}?`}
                description="Anything using this key stops working right away."
                confirmLabel="Revoke key"
                pending={remove.isPending}
                onConfirm={() => remove.mutate(k.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
