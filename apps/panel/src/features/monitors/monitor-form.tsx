import { useForm, useStore } from "@tanstack/react-form";
import {
  DNS_RECORD_TYPES,
  HTTP_METHODS,
  MonitorInput,
  validate,
  type Monitor,
  type MonitorDraft,
  type MonitorType,
} from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input, inputClass } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { Switch } from "@tiny-uptime/ui/components/switch";
import { cn } from "cn";
import { useState } from "react";
import { ApiError, messageOf } from "../../lib/api";
import { AlertRulesFields, initialRules, RULE_FIELDS, rulesToDraft, type AlertRules } from "./alert-rules";

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

/** Types checked by calling a URL, which may need request headers. */
const URL_TYPES: MonitorType[] = ["http", "websocket", "mcp", "evm", "solana"];
const URL_LABELS: Partial<Record<MonitorType, string>> = {
  websocket: "WebSocket URL",
  mcp: "Server URL",
  evm: "RPC URL",
  solana: "RPC URL",
};
/** Database ports have defaults, so the port may stay empty. */
const DEFAULT_PORTS: Partial<Record<MonitorType, string>> = { postgres: "5432", mysql: "3306", redis: "6379" };

const INTERVALS = [
  { value: "60", label: "Every minute" },
  { value: "300", label: "Every 5 minutes" },
  { value: "600", label: "Every 10 minutes" },
  { value: "1800", label: "Every 30 minutes" },
  { value: "3600", label: "Every hour" },
] as const;

/** Registration dates change slowly, and RDAP servers limit lookups. */
const DOMAIN_INTERVALS = [
  { value: "3600", label: "Every hour" },
  { value: "21600", label: "Every 6 hours" },
  { value: "43200", label: "Every 12 hours" },
  { value: "86400", label: "Every day" },
] as const;

/** Every input is text in the form; numbers and lists are parsed only when the draft is built. */
type Values = {
  type: MonitorType;
  name: string;
  intervalSec: string;
  public: boolean;
  url: string;
  method: (typeof HTTP_METHODS)[number];
  expectedStatus: string;
  keyword: string;
  keywordMode: "contains" | "absent";
  headers: string;
  body: string;
  host: string;
  port: string;
  graceSec: string;
  timeoutSec: string;
  recordType: (typeof DNS_RECORD_TYPES)[number];
  expectedValue: string;
  expectedMode: "exact" | "contains";
  message: string;
  domain: string;
  warnDays: string;
  chainId: string;
};

function initialValues(monitor?: Monitor): Values {
  const m = monitor as (Monitor & Record<string, unknown>) | undefined;
  const http = monitor?.type === "http" ? monitor : undefined;
  return {
    type: monitor?.type ?? "http",
    name: monitor?.name ?? "",
    intervalSec: String(monitor?.intervalSec ?? 300),
    public: monitor?.public ?? false,
    url: typeof m?.url === "string" ? m.url : "https://",
    method: http?.method ?? "GET",
    expectedStatus: http?.expectedStatus.join(", ") ?? "",
    keyword: http?.keyword?.value ?? "",
    keywordMode: http?.keyword?.mode ?? "contains",
    headers:
      m?.headers && typeof m.headers === "object"
        ? Object.entries(m.headers as Record<string, string>)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
        : "",
    body: http?.body ?? "",
    host: typeof m?.host === "string" ? m.host : "",
    port: typeof m?.port === "number" ? String(m.port) : monitor?.type === "minecraft" ? "25565" : "",
    graceSec: monitor?.type === "heartbeat" ? String(monitor.graceSec) : "60",
    timeoutSec: typeof m?.timeoutMs === "number" ? String(m.timeoutMs / 1000) : "10",
    recordType: monitor?.type === "dns" ? monitor.recordType : "A",
    expectedValue: monitor?.type === "dns" ? (monitor.expected?.value ?? "") : "",
    expectedMode: monitor?.type === "dns" ? (monitor.expected?.mode ?? "exact") : "exact",
    message: monitor?.type === "websocket" ? (monitor.message ?? "") : "",
    domain: monitor?.type === "domain" ? monitor.domain : "",
    warnDays: monitor?.type === "domain" ? String(monitor.warnDays) : "30",
    chainId: monitor?.type === "evm" && monitor.chainId !== undefined ? String(monitor.chainId) : "",
  };
}

/** Builds the API draft for the chosen type, carrying only that type's fields. */
function toDraft(v: Values): MonitorDraft {
  const common = { name: v.name, intervalSec: Number(v.intervalSec), public: v.public };
  const timeoutMs = Math.round(Number(v.timeoutSec) * 1000);
  switch (v.type) {
    case "http":
      return {
        type: "http",
        ...common,
        url: v.url,
        method: v.method,
        timeoutMs,
        expectedStatus: v.expectedStatus
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number),
        headers: parseHeaders(v.headers),
        ...(v.body && v.method !== "GET" && v.method !== "HEAD" ? { body: v.body } : {}),
        ...(v.keyword ? { keyword: { value: v.keyword, mode: v.keywordMode } } : {}),
      };
    case "tcp":
    case "minecraft":
      return { type: v.type, ...common, host: v.host, port: Number(v.port), timeoutMs };
    case "heartbeat":
      return { type: "heartbeat", ...common, graceSec: Number(v.graceSec) };
    case "dns":
      return {
        type: "dns",
        ...common,
        host: v.host,
        recordType: v.recordType,
        timeoutMs,
        ...(v.expectedValue.trim() ? { expected: { value: v.expectedValue, mode: v.expectedMode } } : {}),
      };
    case "postgres":
    case "mysql":
    case "redis":
      return { type: v.type, ...common, host: v.host, timeoutMs, ...(v.port.trim() ? { port: Number(v.port) } : {}) };
    case "websocket":
      return {
        type: "websocket",
        ...common,
        url: v.url,
        headers: parseHeaders(v.headers),
        timeoutMs,
        ...(v.message ? { message: v.message } : {}),
      };
    case "domain":
      return { type: "domain", ...common, domain: v.domain, warnDays: Number(v.warnDays), timeoutMs };
    case "mcp":
    case "solana":
      return { type: v.type, ...common, url: v.url, headers: parseHeaders(v.headers), timeoutMs };
    case "evm":
      return {
        type: "evm",
        ...common,
        url: v.url,
        headers: parseHeaders(v.headers),
        timeoutMs,
        ...(v.chainId.trim() ? { chainId: Number(v.chainId) } : {}),
      };
  }
}

/** "Name: value" lines, as typed in the headers box. */
function parseHeaders(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]),
  );
}

/** Server and schema field names, mapped to the input that shows the error. */
function fieldOf(field: string): keyof Values | keyof AlertRules {
  const rule = RULE_FIELDS.find((f) => field === f || field.startsWith(`${f}.`));
  if (rule) return rule;
  if (field.startsWith("headers")) return "headers";
  if (field.startsWith("expectedStatus")) return "expectedStatus";
  if (field.startsWith("keyword")) return "keyword";
  if (field.startsWith("expected.")) return "expectedValue";
  if (field === "timeoutMs") return "timeoutSec";
  return field as keyof Values;
}

type Props = { monitor?: Monitor; submitLabel: string; onSubmit: (draft: MonitorDraft) => Promise<unknown>; onCancel: () => void };

export function MonitorForm({ monitor, submitLabel, onSubmit, onCancel }: Props) {
  const [errors, setErrors] = useState<Partial<Record<keyof Values | keyof AlertRules, string>>>({});
  const [rules, setRules] = useState(() => initialRules(monitor));
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: initialValues(monitor),
    onSubmit: async ({ value }) => {
      setFormError(null);
      const draft = { ...toDraft(value), ...rulesToDraft(rules) } as MonitorDraft;
      const checked = validate(MonitorInput, draft);
      if (!checked.ok) {
        setErrors({ [fieldOf(checked.field)]: tidy(checked.message, checked.field) });
        return;
      }
      setErrors({});
      try {
        await onSubmit(draft);
      } catch (error) {
        if (error instanceof ApiError && error.field) setErrors({ [fieldOf(error.field)]: tidy(error.message, error.field) });
        else setFormError(messageOf(error));
      }
    },
  });
  const type = useStore(form.store, (s) => s.values.type);
  const method = useStore(form.store, (s) => s.values.method);
  const submitting = useStore(form.store, (s) => s.isSubmitting);

  const text = (name: keyof Values, label: string, props: React.ComponentProps<typeof Input> & { description?: string } = {}) => {
    const { description, ...inputProps } = props;
    return (
      <form.Field name={name}>
        {(field) => (
          <Field label={label} description={description} error={errors[name]}>
            <Input
              value={String(field.state.value)}
              onChange={(e) => field.handleChange(e.target.value as never)}
              onBlur={field.handleBlur}
              {...inputProps}
            />
          </Field>
        )}
      </form.Field>
    );
  };

  const headersField = () => (
    <form.Field name="headers">
      {(field) => (
        <Field
          label={type === "websocket" ? "Handshake headers" : "Request headers"}
          description="One per line, like Authorization: Bearer …"
          error={errors.headers}
        >
          <textarea
            rows={2}
            spellCheck={false}
            className={cn(inputClass, "h-auto py-2 font-mono text-[0.8125rem]")}
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
          />
        </Field>
      )}
    </form.Field>
  );

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
      {text("name", "Name", { autoFocus: !monitor, placeholder: type === "heartbeat" ? "Nightly backup" : "Website" })}

      {URL_TYPES.includes(type) ? text("url", URL_LABELS[type] ?? "URL", { type: "url", inputMode: "url", spellCheck: false }) : null}

      {type === "http" ? (
        <>
          <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
            <form.Field name="method">
              {(field) => (
                <Field label="Method">
                  <Select
                    label="Method"
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v)}
                    options={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
                  />
                </Field>
              )}
            </form.Field>
            {text("expectedStatus", "Expected status codes", {
              placeholder: "Any below 400",
              inputMode: "numeric",
              description: "Separate several with commas.",
            })}
          </div>
          <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
            {text("keyword", "Keyword", { placeholder: "Optional", description: "Checks the first 256 KB of the response." })}
            <form.Field name="keywordMode">
              {(field) => (
                <Field label="Keyword must be">
                  <Select
                    label="Keyword must be"
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v)}
                    options={[
                      { value: "contains", label: "Present" },
                      { value: "absent", label: "Absent" },
                    ]}
                  />
                </Field>
              )}
            </form.Field>
          </div>
          {headersField()}
          {method !== "GET" && method !== "HEAD" ? (
            <form.Field name="body">
              {(field) => (
                <Field label="Request body" error={errors.body}>
                  <textarea
                    rows={3}
                    spellCheck={false}
                    className={cn(inputClass, "h-auto py-2 font-mono text-[0.8125rem]")}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Field>
              )}
            </form.Field>
          ) : null}
        </>
      ) : null}

      {type !== "http" && URL_TYPES.includes(type) ? headersField() : null}

      {type === "websocket"
        ? text("message", "Message to send", {
            placeholder: "Optional",
            spellCheck: false,
            description: "Sent once connected. Any reply within the timeout counts as up.",
          })
        : null}

      {type === "evm"
        ? text("chainId", "Chain ID", {
            placeholder: "Any",
            inputMode: "numeric",
            description: "Down when the node serves another chain. Ethereum mainnet is 1.",
          })
        : null}

      {type === "tcp" || type === "minecraft" || DEFAULT_PORTS[type] ? (
        <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
          {text("host", "Host", { spellCheck: false, placeholder: type === "minecraft" ? "mc.example.com" : "db.example.com" })}
          {text("port", "Port", { inputMode: "numeric", ...(DEFAULT_PORTS[type] ? { placeholder: DEFAULT_PORTS[type] } : {}) })}
        </div>
      ) : null}

      {type === "dns" ? (
        <>
          <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
            {text("host", "Record name", { spellCheck: false, placeholder: "example.com" })}
            <form.Field name="recordType">
              {(field) => (
                <Field label="Record type">
                  <Select
                    label="Record type"
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v)}
                    options={DNS_RECORD_TYPES.map((t) => ({ value: t, label: t }))}
                  />
                </Field>
              )}
            </form.Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
            {text("expectedValue", "Expected value", {
              placeholder: "Any record",
              spellCheck: false,
              description: "Down unless a record matches. MX values include the priority, like 10 mail.example.com.",
            })}
            <form.Field name="expectedMode">
              {(field) => (
                <Field label="Value must">
                  <Select
                    label="Value must"
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v)}
                    options={[
                      { value: "exact", label: "Match exactly" },
                      { value: "contains", label: "Be contained" },
                    ]}
                  />
                </Field>
              )}
            </form.Field>
          </div>
        </>
      ) : null}

      {type === "domain" ? (
        <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
          {text("domain", "Domain", {
            spellCheck: false,
            placeholder: "example.com",
            description: "The registered domain, not a subdomain.",
          })}
          {text("warnDays", "Warn days ahead", { inputMode: "numeric" })}
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <form.Field name="intervalSec">
          {(field) => (
            <Field label={type === "heartbeat" ? "Expected every" : "Check"}>
              <Select
                label={type === "heartbeat" ? "Expected every" : "Check"}
                value={field.state.value}
                onValueChange={(v) => field.handleChange(v)}
                options={type === "domain" ? DOMAIN_INTERVALS : INTERVALS}
              />
            </Field>
          )}
        </form.Field>
        {type === "heartbeat"
          ? text("graceSec", "Grace period (seconds)", { inputMode: "numeric", description: "Extra time before a missed ping counts." })
          : text("timeoutSec", "Timeout (seconds)", { inputMode: "decimal" })}
      </div>

      <AlertRulesFields
        value={rules}
        onChange={setRules}
        errors={errors}
        {...(monitor ? { monitorId: monitor.id } : {})}
        heartbeat={type === "heartbeat"}
      />

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
        <p role="alert" className="text-[0.8125rem] text-down">
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

/** "url: must be an http or https URL" reads better as "Must be an http or https URL". */
function tidy(message: string, field: string): string {
  const text = message.startsWith(`${field}: `) ? message.slice(field.length + 2) : message;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
