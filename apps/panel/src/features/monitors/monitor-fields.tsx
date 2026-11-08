import { DNS_RECORD_TYPES, HTTP_METHODS, type MonitorType } from "@tiny-uptime/contracts";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { Textarea } from "@tiny-uptime/ui/components/textarea";
import type { AlertRules } from "./alert-rules";
import type { MonitorFormApi } from "./monitor-form";
import type { TextField, Values } from "./monitor-values";

export type Errors = Partial<Record<keyof Values | keyof AlertRules, string>>;

/** Types checked by calling a URL, which may need request headers. */
export const URL_TYPES: readonly MonitorType[] = ["http", "websocket", "mcp", "evm", "solana"];
export const URL_LABELS: Partial<Record<MonitorType, string>> = {
  websocket: "WebSocket URL",
  mcp: "Server URL",
  evm: "RPC URL",
  solana: "RPC URL",
};
/** Database ports have defaults, so the port may stay empty. */
export const DEFAULT_PORTS: Partial<Record<MonitorType, string>> = { postgres: "5432", mysql: "3306", redis: "6379" };

type SelectField = "method" | "keywordMode" | "recordType" | "expectedMode" | "intervalSec";
type CodeField = "headers" | "jsonAssertions" | "body";
type InputProps = React.ComponentProps<typeof Input> & { description?: string };

/** One builder per kind of input, bound to the form and its errors, so each field is a line. */
export function fieldsFor(form: MonitorFormApi, errors: Errors) {
  const text = (name: TextField, label: string, { description, ...props }: InputProps = {}) => (
    <form.Field name={name}>
      {(field) => (
        <Field label={label} description={description} error={errors[name]}>
          <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} {...props} />
        </Field>
      )}
    </form.Field>
  );

  const select = <K extends SelectField>(name: K, label: string, options: readonly { value: Values[K]; label: string }[]) => (
    <form.Field name={name}>
      {(field) => (
        <Field label={label} error={errors[name]}>
          <Select<Values[K]>
            label={label}
            value={field.state.value}
            // TanStack types the value through a lookup TypeScript cannot relate back to Values[K].
            onValueChange={(v) => field.handleChange(v as never)}
            options={options}
          />
        </Field>
      )}
    </form.Field>
  );

  const code = (
    name: CodeField,
    label: string,
    { rows = 2, description, placeholder }: { rows?: number; description?: string; placeholder?: string } = {},
  ) => (
    <form.Field name={name}>
      {(field) => (
        <Field label={label} description={description} error={errors[name]}>
          <Textarea
            rows={rows}
            spellCheck={false}
            placeholder={placeholder}
            className="font-mono text-small"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
          />
        </Field>
      )}
    </form.Field>
  );

  return { text, select, code };
}

type Fields = ReturnType<typeof fieldsFor>;

export function HttpFields({ f, method }: { f: Fields; method: Values["method"] }) {
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
        {f.select(
          "method",
          "Method",
          HTTP_METHODS.map((m) => ({ value: m, label: m })),
        )}
        {f.text("expectedStatus", "Expected status codes", {
          placeholder: "Any below 400",
          inputMode: "numeric",
          description: "Separate several with commas.",
        })}
      </div>
      <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
        {f.text("keyword", "Keyword", { placeholder: "Optional", description: "Checks the first 256 KB of the response." })}
        {f.select("keywordMode", "Keyword must be", [
          { value: "contains", label: "Present" },
          { value: "absent", label: "Absent" },
        ])}
      </div>
      {f.code("jsonAssertions", "JSON checks", {
        placeholder: "Optional",
        description: "One per line: a path, then ==, !=, contains, >, <, exists or missing, then the value. For example $.status == ok.",
      })}
      <HeadersField f={f} type="http" />
      {method !== "GET" && method !== "HEAD" ? f.code("body", "Request body", { rows: 3 }) : null}
    </>
  );
}

export function HeadersField({ f, type }: { f: Fields; type: MonitorType }) {
  return f.code("headers", type === "websocket" ? "Handshake headers" : "Request headers", {
    description: "One per line, like Authorization: Bearer …",
  });
}

export function HostFields({ f, type }: { f: Fields; type: MonitorType }) {
  const port = DEFAULT_PORTS[type];
  return (
    <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
      {f.text("host", "Host", { spellCheck: false, placeholder: type === "minecraft" ? "mc.example.com" : "db.example.com" })}
      {f.text("port", "Port", { inputMode: "numeric", ...(port ? { placeholder: port } : {}) })}
    </div>
  );
}

export function DnsFields({ f }: { f: Fields }) {
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
        {f.text("host", "Record name", { spellCheck: false, placeholder: "example.com" })}
        {f.select(
          "recordType",
          "Record type",
          DNS_RECORD_TYPES.map((t) => ({ value: t, label: t })),
        )}
      </div>
      <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
        {f.text("expectedValue", "Expected value", {
          placeholder: "Any record",
          spellCheck: false,
          description: "Down unless a record matches. MX values include the priority, like 10 mail.example.com.",
        })}
        {f.select("expectedMode", "Value must", [
          { value: "exact", label: "Match exactly" },
          { value: "contains", label: "Be contained" },
        ])}
      </div>
    </>
  );
}

export function DomainFields({ f }: { f: Fields }) {
  return (
    <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
      {f.text("domain", "Domain", {
        spellCheck: false,
        placeholder: "example.com",
        description: "The registered domain, not a subdomain.",
      })}
      {f.text("warnDays", "Warn days ahead", { inputMode: "numeric" })}
    </div>
  );
}
