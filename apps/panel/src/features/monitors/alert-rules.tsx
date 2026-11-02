import { useQuery } from "@tanstack/react-query";
import type { Monitor, MonitorDraft } from "@tiny-uptime/contracts";
import { CheckboxList } from "@tiny-uptime/ui/components/checkbox";
import { Disclosure } from "@tiny-uptime/ui/components/disclosure";
import { Field } from "@tiny-uptime/ui/components/field";
import { FieldGroup } from "@tiny-uptime/ui/components/field-group";
import { Input } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { useState } from "react";
import { channelsQuery, monitorsQuery } from "../../lib/queries";

/** How a monitor judges its checks and whom it alerts, edited as text and parsed into the draft. */
export type AlertRules = {
  failureThreshold: string;
  recoveryThreshold: string;
  slowThresholdMs: string;
  slowAlertAfter: string;
  tags: string;
  dependsOn: string;
  channelIds: string[];
};

export const RULE_FIELDS = [
  "failureThreshold",
  "recoveryThreshold",
  "slowThresholdMs",
  "slowAlertAfter",
  "tags",
  "dependsOn",
  "channelIds",
] as const;

export function initialRules(monitor?: Monitor): AlertRules {
  return {
    failureThreshold: String(monitor?.failureThreshold ?? 2),
    recoveryThreshold: String(monitor?.recoveryThreshold ?? 1),
    slowThresholdMs: monitor?.slowThresholdMs ? String(monitor.slowThresholdMs) : "",
    slowAlertAfter: String(monitor?.slowAlertAfter ?? 3),
    tags: (monitor?.tags ?? []).join(", "),
    dependsOn: monitor?.dependsOn ?? "",
    channelIds: monitor?.channelIds ?? [],
  };
}

export function rulesToDraft(rules: AlertRules): Partial<MonitorDraft> {
  return {
    failureThreshold: Number(rules.failureThreshold),
    recoveryThreshold: Number(rules.recoveryThreshold),
    slowThresholdMs: rules.slowThresholdMs.trim() ? Number(rules.slowThresholdMs) : null,
    slowAlertAfter: Number(rules.slowAlertAfter),
    tags: rules.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    dependsOn: rules.dependsOn || null,
    channelIds: rules.channelIds,
  };
}

type Props = {
  value: AlertRules;
  onChange: (value: AlertRules) => void;
  errors: Partial<Record<keyof AlertRules, string>>;
  monitorId?: string;
  heartbeat: boolean;
};

/** Alert rules, folded away by default: the defaults suit most monitors. Opens on its own when it has an error. */
export function AlertRulesFields({ value, onChange, errors, monitorId, heartbeat }: Props) {
  const monitors = useQuery(monitorsQuery());
  const channels = useQuery(channelsQuery());
  const set = <K extends keyof AlertRules>(key: K, next: AlertRules[K]) => onChange({ ...value, [key]: next });
  const hasError = RULE_FIELDS.some((f) => errors[f]);
  const [open, setOpen] = useState(false);
  const others = (monitors.data ?? []).filter((m) => m.id !== monitorId);

  return (
    <Disclosure title="Alert rules" summary={summary(value)} open={open || hasError} onOpenChange={setOpen}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Down after" description="Failed checks in a row." error={errors.failureThreshold}>
          <Input inputMode="numeric" value={value.failureThreshold} onChange={(e) => set("failureThreshold", e.target.value)} />
        </Field>
        <Field label="Recovered after" description="Successful checks in a row." error={errors.recoveryThreshold}>
          <Input inputMode="numeric" value={value.recoveryThreshold} onChange={(e) => set("recoveryThreshold", e.target.value)} />
        </Field>
      </div>
      {heartbeat ? null : (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Slow above (ms)" description="Leave empty to ignore speed." error={errors.slowThresholdMs}>
            <Input
              inputMode="numeric"
              placeholder="Off"
              value={value.slowThresholdMs}
              onChange={(e) => set("slowThresholdMs", e.target.value)}
            />
          </Field>
          <Field
            label="Alert after slow checks"
            description="Slow checks in a row before a slow incident. 0 only marks it degraded."
            error={errors.slowAlertAfter}
          >
            <Input
              inputMode="numeric"
              value={value.slowAlertAfter}
              onChange={(e) => set("slowAlertAfter", e.target.value)}
              disabled={!value.slowThresholdMs.trim()}
            />
          </Field>
        </div>
      )}
      <Field
        label="Depends on"
        description="While that monitor is down, this one records incidents without alerting."
        error={errors.dependsOn}
      >
        <Select
          label="Depends on"
          value={value.dependsOn || "none"}
          onValueChange={(v) => set("dependsOn", v === "none" ? "" : v)}
          options={[{ value: "none", label: "Nothing" }, ...others.map((m) => ({ value: m.id, label: m.name }))]}
        />
      </Field>
      <FieldGroup legend="Alert" description="Pick none to alert every enabled channel." error={errors.channelIds}>
        {(channels.data ?? []).length ? (
          <CheckboxList
            value={value.channelIds}
            onValueChange={(ids) => set("channelIds", ids)}
            options={(channels.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">No alert channels yet. Add one under Alerts.</p>
        )}
      </FieldGroup>
      <Field label="Tags" description="Separate with commas, like production, api." error={errors.tags}>
        <Input value={value.tags} onChange={(e) => set("tags", e.target.value)} />
      </Field>
    </Disclosure>
  );
}

function summary(rules: AlertRules): string {
  const parts = [`down after ${rules.failureThreshold}`];
  if (rules.slowThresholdMs.trim()) parts.push(`slow above ${rules.slowThresholdMs} ms`);
  if (rules.dependsOn) parts.push("has a dependency");
  return parts.join(" · ");
}
