import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChannelInput, NTFY_PRIORITIES, validate, type ChannelDraft, type ChannelType } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { notify } from "@tiny-uptime/ui/components/toast";
import { useState } from "react";
import { api, ApiError, messageOf } from "../../lib/api";
import { channelsQuery } from "../../lib/queries";
import { CHANNEL_FIELDS, CHANNEL_TYPE_OPTIONS, type SettingField } from "./channel-types";

/** Every setting is text in the form; only the chosen type's are sent. */
type Values = { type: ChannelType; name: string; priority: string } & Record<Exclude<SettingField, "priority">, string>;

const INITIAL: Values = {
  type: "slack",
  name: "",
  url: "",
  topic: "",
  token: "",
  priority: "3",
  secret: "",
  botToken: "",
  chatId: "",
  routingKey: "",
  to: "",
};

const PRIORITIES = NTFY_PRIORITIES.map((p) => ({
  value: String(p),
  label: { 1: "1 · Min", 2: "2 · Low", 3: "3 · Default", 4: "4 · High", 5: "5 · Urgent" }[p],
}));

function toDraft(v: Values): ChannelDraft {
  const pick = Object.fromEntries(CHANNEL_FIELDS[v.type].map((f) => [f.name, v[f.name]]).filter(([, value]) => value !== ""));
  return {
    type: v.type,
    name: v.name,
    ...pick,
    ...(v.type === "ntfy" ? { priority: Number(v.priority) } : {}),
  } as ChannelDraft;
}

function tidy(message: string, field: string): string {
  const text = message.startsWith(`${field}: `) ? message.slice(field.length + 2) : message;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ChannelForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useMutation({
    meta: { inlineErrors: true },
    mutationFn: (draft: ChannelDraft) => api.channels.create(draft),
    onSuccess: async (channel) => {
      await queryClient.invalidateQueries({ queryKey: channelsQuery().queryKey });
      notify(`${channel.name} added`, { description: "Send a test to check it receives alerts.", type: "success" });
      onDone();
    },
  });
  const form = useForm({
    defaultValues: INITIAL,
    onSubmit: async ({ value }) => {
      setFormError(null);
      const draft = toDraft(value);
      const checked = validate(ChannelInput, draft);
      if (!checked.ok) {
        setErrors({ [checked.field]: tidy(checked.message, checked.field) });
        return;
      }
      setErrors({});
      try {
        await create.mutateAsync(draft);
      } catch (error) {
        if (error instanceof ApiError && error.field) setErrors({ [error.field]: tidy(error.message, error.field) });
        else setFormError(messageOf(error));
      }
    },
  });
  const type = useStore(form.store, (s) => s.values.type);
  const submitting = useStore(form.store, (s) => s.isSubmitting);

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="type">
        {(field) => (
          <Field label="Send alerts to">
            <Select
              label="Send alerts to"
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v);
                setErrors({});
              }}
              options={CHANNEL_TYPE_OPTIONS}
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="name">
        {(field) => (
          <Field label="Name" error={errors.name}>
            <Input autoFocus placeholder="On-call phone" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
          </Field>
        )}
      </form.Field>
      {CHANNEL_FIELDS[type].map((spec) => (
        <form.Field key={`${type}-${spec.name}`} name={spec.name}>
          {(field) => (
            <Field label={spec.label} description={spec.description} error={errors[spec.name]}>
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={spec.placeholder}
                spellCheck={false}
                autoComplete="off"
                {...(spec.kind === "url" ? { type: "url", inputMode: "url" as const } : {})}
                {...(spec.kind === "email" ? { type: "email", inputMode: "email" as const } : {})}
                {...(spec.kind === "secret" ? { type: "password" } : {})}
              />
            </Field>
          )}
        </form.Field>
      ))}
      {type === "ntfy" ? (
        <form.Field name="priority">
          {(field) => (
            <Field label="Priority" error={errors.priority}>
              <Select label="Priority" value={field.state.value} onValueChange={(v) => field.handleChange(v)} options={PRIORITIES} />
            </Field>
          )}
        </form.Field>
      ) : null}
      {formError ? (
        <p role="alert" className="text-small text-down">
          {formError}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={submitting}>
          Add channel
        </Button>
      </div>
    </form>
  );
}
