import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AlertPolicy } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { CheckboxList } from "@tiny-uptime/ui/components/checkbox";
import { Field } from "@tiny-uptime/ui/components/field";
import { FieldGroup } from "@tiny-uptime/ui/components/field-group";
import { Select } from "@tiny-uptime/ui/components/select";
import { Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { notify } from "@tiny-uptime/ui/components/toast";
import { useEffect, useState } from "react";
import { api, messageOf } from "../../lib/api";
import { alertPolicyQuery, channelsQuery } from "../../lib/queries";

const REMINDERS = [
  { value: "0", label: "Never" },
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every hour" },
  { value: "240", label: "Every 4 hours" },
] as const;

const ESCALATION = [
  { value: "0", label: "Never" },
  { value: "15", label: "After 15 minutes" },
  { value: "30", label: "After 30 minutes" },
  { value: "60", label: "After 1 hour" },
  { value: "240", label: "After 4 hours" },
] as const;

/** What happens while an incident is open and nobody has acknowledged it. */
export function AlertPolicySection() {
  const policy = useQuery(alertPolicyQuery());
  const channels = useQuery(channelsQuery());
  const [draft, setDraft] = useState<AlertPolicy | null>(null);
  useEffect(() => {
    if (policy.data && !draft) setDraft(policy.data);
  }, [policy.data, draft]);
  const queryClient = useQueryClient();
  const save = useMutation({
    meta: { inlineErrors: true },
    mutationFn: (p: AlertPolicy) => api.alertPolicy.set(p),
    onSuccess: async (saved) => {
      queryClient.setQueryData(alertPolicyQuery().queryKey, saved);
      notify("Follow-up rules saved", { type: "success" });
    },
  });
  const dirty = draft && policy.data && JSON.stringify(draft) !== JSON.stringify(policy.data);

  return (
    <Section title="Follow-ups" description="While an incident is open and nobody has acknowledged it.">
      {!draft ? (
        <div className="p-5">
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <form
          className="flex flex-col gap-5 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft);
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Remind" description="Repeats the alert on the monitor's channels.">
              <Select<string>
                label="Remind"
                value={String(draft.reminderEveryMinutes)}
                onValueChange={(v) => setDraft({ ...draft, reminderEveryMinutes: Number(v) })}
                options={REMINDERS}
              />
            </Field>
            <Field label="Escalate outages" description="Sends one alert to the channels below.">
              <Select<string>
                label="Escalate outages"
                value={String(draft.escalateAfterMinutes)}
                onValueChange={(v) => setDraft({ ...draft, escalateAfterMinutes: Number(v) })}
                options={ESCALATION}
              />
            </Field>
          </div>
          {draft.escalateAfterMinutes > 0 ? (
            <FieldGroup
              legend="Escalate to"
              error={draft.escalationChannelIds.length === 0 ? "Pick at least one channel, or nothing escalates." : undefined}
            >
              <CheckboxList
                value={draft.escalationChannelIds}
                onValueChange={(ids) => setDraft({ ...draft, escalationChannelIds: ids })}
                options={(channels.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </FieldGroup>
          ) : null}
          {save.isError ? <p className="text-small text-down">{messageOf(save.error)}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={!dirty} loading={save.isPending}>
              Save follow-ups
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}
