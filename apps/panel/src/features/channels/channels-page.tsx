import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChannelInput, type Channel } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { ConfirmDialog, Dialog } from "@tiny-uptime/ui/components/dialog";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input } from "@tiny-uptime/ui/components/input";
import { Menu } from "@tiny-uptime/ui/components/menu";
import { EmptyState, Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { notify } from "@tiny-uptime/ui/components/toast";
import { Bell, Ellipsis, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, messageOf } from "../../lib/api";
import { firstError } from "../../lib/forms";
import { channelsQuery } from "../../lib/queries";
import { PageHeader } from "../shell/page-header";
import { AlertPolicySection } from "./alert-policy-section";

export function ChannelsPage() {
  const channels = useQuery(channelsQuery());
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Alerts"
        description="Where incidents are sent. Webhooks receive a JSON body in OpenUptime's format, so receivers built for it keep working."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus />
            New webhook
          </Button>
        }
      />
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New webhook"
        description="tiny-uptime sends a POST when an incident opens and when it resolves."
      >
        <ChannelForm onDone={() => setCreating(false)} />
      </Dialog>
      <Section>
        {channels.isPending ? (
          <div className="p-5">
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : (channels.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Bell />}
            title="No alerts are being sent"
            description="Add a webhook so someone hears about it when a monitor goes down."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus />
                Add a webhook
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {channels.data!.map((c) => (
              <ChannelRow key={c.id} channel={c} />
            ))}
          </ul>
        )}
      </Section>
      <div className="mt-6">
        <AlertPolicySection />
      </div>
    </>
  );
}

function ChannelRow({ channel: c }: { channel: Channel }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: channelsQuery().queryKey });
  const test = useMutation({
    mutationFn: () => api.channels.test(c.id),
    onSuccess: () => notify("Test alert delivered", { description: `${c.host} accepted it.`, type: "success" }),
  });
  const toggle = useMutation({ mutationFn: () => api.channels.update(c.id, { enabled: !c.enabled }), onSuccess: refresh });
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({ mutationFn: () => api.channels.remove(c.id), onSuccess: refresh });
  return (
    <li className="flex items-center gap-3 px-5 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{c.name}</span>
        <span className="truncate text-[0.8125rem] text-muted-foreground">
          Webhook · {c.host}
          {c.enabled ? "" : " · paused"}
        </span>
      </div>
      <Button size="sm" loading={test.isPending} onClick={() => test.mutate()}>
        <Send />
        Send test
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${c.name}?`}
        description="Incidents stop being sent there, and pending retries are dropped."
        confirmLabel="Delete webhook"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
      <Menu
        trigger={
          <Button variant="ghost" size="icon" aria-label={`More actions for ${c.name}`}>
            <Ellipsis />
          </Button>
        }
        actions={[
          { label: c.enabled ? "Pause alerts" : "Resume alerts", onClick: () => toggle.mutate() },
          "separator",
          { label: "Delete", icon: <Trash2 />, danger: true, onClick: () => setConfirming(true) },
        ]}
      />
    </li>
  );
}

function ChannelForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    meta: { inlineErrors: true },
    mutationFn: (value: { name: string; url: string }) => api.channels.create({ type: "webhook", ...value }),
    onSuccess: async (channel) => {
      await queryClient.invalidateQueries({ queryKey: channelsQuery().queryKey });
      notify(`${channel.name} added`, { description: "Send a test to check it receives alerts.", type: "success" });
      onDone();
    },
  });
  const form = useForm({
    defaultValues: { type: "webhook" as const, name: "", url: "https://" },
    validators: { onSubmit: ChannelInput },
    onSubmit: ({ value }) => create.mutate({ name: value.name, url: value.url }),
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name">
        {(field) => (
          <Field label="Name" error={firstError(field.state.meta.errors)}>
            <Input autoFocus placeholder="Phone (kukuroo)" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
          </Field>
        )}
      </form.Field>
      <form.Field name="url">
        {(field) => (
          <Field
            label="Webhook URL"
            description="Only its host is shown afterwards: the path often carries a secret."
            error={firstError(field.state.meta.errors)}
          >
            <Input
              type="url"
              inputMode="url"
              spellCheck={false}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          </Field>
        )}
      </form.Field>
      {create.isError ? (
        <p role="alert" className="text-[0.8125rem] text-down">
          {messageOf(create.error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Add webhook
        </Button>
      </div>
    </form>
  );
}
