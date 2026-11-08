import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Channel } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { ConfirmDialog, Dialog } from "@tiny-uptime/ui/components/dialog";
import { Menu } from "@tiny-uptime/ui/components/menu";
import { EmptyState, Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { notify } from "@tiny-uptime/ui/components/toast";
import { Bell, Ellipsis, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { channelsQuery } from "../../lib/queries";
import { PageHeader } from "../shell/page-header";
import { AlertPolicySection } from "./alert-policy-section";
import { ChannelForm } from "./channel-form";
import { CHANNEL_TYPE_LABEL } from "./channel-types";

export function ChannelsPage() {
  const channels = useQuery(channelsQuery());
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Alerts"
        description="Where incidents are sent: chat, push, email, PagerDuty or a webhook in OpenUptime's JSON format."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus />
            New channel
          </Button>
        }
      />
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New alert channel"
        description="tiny-uptime sends an alert when an incident opens, when it resolves, and for reminders and escalations."
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
            description="Add a channel so someone hears about it when a monitor goes down."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus />
                Add a channel
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
    onSuccess: () => notify("Test alert delivered", { description: `${c.target} accepted it.`, type: "success" }),
  });
  const toggle = useMutation({ mutationFn: () => api.channels.update(c.id, { enabled: !c.enabled }), onSuccess: refresh });
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({ mutationFn: () => api.channels.remove(c.id), onSuccess: refresh });
  return (
    <li className="flex items-center gap-3 px-5 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{c.name}</span>
        <span className="truncate text-small text-muted-foreground">
          {CHANNEL_TYPE_LABEL[c.type]} · {c.target}
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
        confirmLabel="Delete channel"
        pending={remove.isPending}
        onConfirm={() => remove.mutateAsync()}
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
