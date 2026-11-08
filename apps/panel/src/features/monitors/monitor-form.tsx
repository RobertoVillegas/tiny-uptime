import { useForm, useStore } from "@tanstack/react-form";
import { MonitorInput, validate, type Monitor, type MonitorDraft, type MonitorType } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { Field } from "@tiny-uptime/ui/components/field";
import { Select } from "@tiny-uptime/ui/components/select";
import { Switch } from "@tiny-uptime/ui/components/switch";
import { useState } from "react";
import { ApiError, messageOf } from "../../lib/api";
import { fieldMessage } from "../../lib/forms";
import { AlertRulesFields, initialRules, rulesToDraft } from "./alert-rules";
import {
  DEFAULT_PORTS,
  DnsFields,
  DomainFields,
  fieldsFor,
  HeadersField,
  HostFields,
  HttpFields,
  URL_LABELS,
  URL_TYPES,
  type Errors,
} from "./monitor-fields";
import { fieldOf, initialValues, toDraft, type Values } from "./monitor-values";

const TYPES: { value: MonitorType; label: string }[] = [
  { value: "http", label: "Website or API (HTTP)" },
  { value: "heartbeat", label: "Heartbeat (cron jobs, workers)" },
  { value: "tcp", label: "TCP port" },
  { value: "minecraft", label: "Minecraft server" },
  { value: "dns", label: "DNS record" },
  { value: "domain", label: "Domain registration expiry" },
  { value: "websocket", label: "WebSocket" },
  { value: "postgres", label: "PostgreSQL server" },
  { value: "mysql", label: "MySQL or MariaDB server" },
  { value: "redis", label: "Redis server" },
  { value: "mcp", label: "MCP server" },
  { value: "evm", label: "EVM node (Ethereum JSON-RPC)" },
  { value: "solana", label: "Solana node" },
];

const INTERVALS = [
  { value: "60", label: "Every minute" },
  { value: "300", label: "Every 5 minutes" },
  { value: "600", label: "Every 10 minutes" },
  { value: "1800", label: "Every 30 minutes" },
  { value: "3600", label: "Every hour" },
];

/** Registration dates change slowly, and RDAP servers limit lookups. */
const DOMAIN_INTERVALS = [
  { value: "3600", label: "Every hour" },
  { value: "21600", label: "Every 6 hours" },
  { value: "43200", label: "Every 12 hours" },
  { value: "86400", label: "Every day" },
];

function useMonitorForm(monitor: Monitor | undefined, onSubmit: (values: Values) => Promise<void>) {
  return useForm({ defaultValues: initialValues(monitor), onSubmit: ({ value }) => onSubmit(value) });
}

/** The form's API with its values typed, for the field builders in monitor-fields. */
export type MonitorFormApi = ReturnType<typeof useMonitorForm>;

type Props = { monitor?: Monitor; submitLabel: string; onSubmit: (draft: MonitorDraft) => Promise<unknown>; onCancel: () => void };

export function MonitorForm({ monitor, submitLabel, onSubmit, onCancel }: Props) {
  const [errors, setErrors] = useState<Errors>({});
  const [rules, setRules] = useState(() => initialRules(monitor));
  const [formError, setFormError] = useState<string | null>(null);
  const form = useMonitorForm(monitor, async (values) => {
    setFormError(null);
    // Spreading the rules over the union loses its tag; toDraft already picked the member.
    const draft = { ...toDraft(values), ...rulesToDraft(rules, values.type) } as MonitorDraft;
    const checked = validate(MonitorInput, draft);
    if (!checked.ok) {
      setErrors({ [fieldOf(checked.field)]: fieldMessage(checked.field, checked.message) });
      return;
    }
    setErrors({});
    try {
      await onSubmit(draft);
    } catch (error) {
      if (error instanceof ApiError && error.field) setErrors({ [fieldOf(error.field)]: fieldMessage(error.field, error.message) });
      else setFormError(messageOf(error));
    }
  });
  const type = useStore(form.store, (s) => s.values.type);
  const method = useStore(form.store, (s) => s.values.method);
  const submitting = useStore(form.store, (s) => s.isSubmitting);
  const f = fieldsFor(form, errors);

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      {monitor ? null : (
        <form.Field name="type">
          {(field) => (
            <Field label="What to monitor">
              <Select
                label="What to monitor"
                value={field.state.value}
                onValueChange={(next) => {
                  if ((next === "domain") !== (field.state.value === "domain")) {
                    form.setFieldValue("intervalSec", next === "domain" ? "86400" : "300");
                  }
                  const url = form.getFieldValue("url");
                  if (next === "websocket" && url === "https://") form.setFieldValue("url", "wss://");
                  if (next !== "websocket" && url === "wss://") form.setFieldValue("url", "https://");
                  field.handleChange(next);
                }}
                options={TYPES}
              />
            </Field>
          )}
        </form.Field>
      )}
      {f.text("name", "Name", { autoFocus: !monitor, placeholder: type === "heartbeat" ? "Nightly backup" : "Website" })}

      {URL_TYPES.includes(type) ? f.text("url", URL_LABELS[type] ?? "URL", { type: "url", inputMode: "url", spellCheck: false }) : null}
      {type === "http" ? <HttpFields f={f} method={method} /> : null}
      {type !== "http" && URL_TYPES.includes(type) ? <HeadersField f={f} type={type} /> : null}
      {type === "websocket"
        ? f.text("message", "Message to send", {
            placeholder: "Optional",
            spellCheck: false,
            description: "Sent once connected. Any reply within the timeout counts as up.",
          })
        : null}
      {type === "evm"
        ? f.text("chainId", "Chain ID", {
            placeholder: "Any",
            inputMode: "numeric",
            description: "Down when the node serves another chain. Ethereum mainnet is 1.",
          })
        : null}
      {type === "tcp" || type === "minecraft" || DEFAULT_PORTS[type] ? <HostFields f={f} type={type} /> : null}
      {type === "dns" ? <DnsFields f={f} /> : null}
      {type === "domain" ? <DomainFields f={f} /> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        {f.select("intervalSec", type === "heartbeat" ? "Expected every" : "Check", type === "domain" ? DOMAIN_INTERVALS : INTERVALS)}
        {type === "heartbeat"
          ? f.text("graceSec", "Grace period (seconds)", { inputMode: "numeric", description: "Extra time before a missed ping counts." })
          : f.text("timeoutSec", "Timeout (seconds)", { inputMode: "decimal" })}
      </div>

      <AlertRulesFields value={rules} onChange={setRules} errors={errors} {...(monitor ? { monitorId: monitor.id } : {})} type={type} />

      <form.Field name="public">
        {(field) => (
          <Switch
            label="Show on the public status page"
            description="Only the name and status are shown, never the target."
            checked={field.state.value}
            onCheckedChange={(v) => field.handleChange(v)}
          />
        )}
      </form.Field>

      {formError ? (
        <p role="alert" className="text-small text-down">
          {formError}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
