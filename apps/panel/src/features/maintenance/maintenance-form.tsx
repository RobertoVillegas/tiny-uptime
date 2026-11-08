import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MaintenanceInput, validate, type Maintenance, type MaintenanceDraft } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { CheckboxList } from "@tiny-uptime/ui/components/checkbox";
import { Field } from "@tiny-uptime/ui/components/field";
import { FieldGroup } from "@tiny-uptime/ui/components/field-group";
import { Input } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { notify } from "@tiny-uptime/ui/components/toast";
import { useMemo, useState } from "react";
import { ApiError, api, messageOf } from "../../lib/api";
import { maintenanceQuery, monitorsQuery } from "../../lib/queries";
import { browserTimezone, isoToLocal, localToIso, timezones } from "../../lib/zoned";

const WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
] as const;

type Repeat = "none" | "daily" | "weekly";
type Values = {
  name: string;
  monitorIds: string[];
  starts: string;
  ends: string;
  repeat: Repeat;
  days: string[];
  timezone: string;
  until: string;
};

function initial(w?: Maintenance): Values {
  const timezone = w?.recurrence?.timezone ?? browserTimezone();
  const now = Date.now();
  const nextHour = new Date(Math.ceil(now / 3_600_000) * 3_600_000).toISOString();
  return {
    name: w?.name ?? "",
    monitorIds: w?.monitorIds ?? [],
    starts: isoToLocal(w?.startsAt ?? nextHour, timezone),
    ends: isoToLocal(w?.endsAt ?? new Date(new Date(nextHour).getTime() + 3_600_000).toISOString(), timezone),
    repeat: w?.recurrence?.frequency ?? "none",
    days: (w?.recurrence?.days ?? []).map(String),
    timezone,
    until: w?.recurrence?.until ? isoToLocal(w.recurrence.until, timezone).slice(0, 10) : "",
  };
}

function toDraft(v: Values): MaintenanceDraft {
  return {
    name: v.name,
    monitorIds: v.monitorIds,
    startsAt: localToIso(v.starts, v.timezone),
    endsAt: localToIso(v.ends, v.timezone),
    recurrence:
      v.repeat === "none"
        ? null
        : {
            frequency: v.repeat,
            days: v.repeat === "weekly" ? v.days.map(Number) : [],
            timezone: v.timezone,
            until: v.until ? localToIso(`${v.until}T23:59`, v.timezone) : null,
          },
  };
}

/** Times are entered in the window's own time zone, which repeating windows keep across DST. */
export function MaintenanceForm({ window, onDone }: { window?: Maintenance; onDone: () => void }) {
  const [v, setV] = useState(() => initial(window));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const monitors = useQuery(monitorsQuery());
  const zones = useMemo(() => timezones().map((z) => ({ value: z, label: z.replace(/_/g, " ") })), []);
  const queryClient = useQueryClient();
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setV((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    meta: { inlineErrors: true },
    mutationFn: (draft: MaintenanceDraft) => (window ? api.maintenance.update(window.id, draft) : api.maintenance.create(draft)),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: maintenanceQuery().queryKey });
      notify(saved.active ? `${saved.name} is in progress` : `${saved.name} scheduled`, { type: "success" });
      onDone();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.field) setErrors({ [error.field.split(".")[0]!]: tidy(error.message) });
      else setErrors({ form: messageOf(error) });
    },
  });

  const submit = () => {
    const draft = toDraft(v);
    const checked = validate(MaintenanceInput, draft);
    if (!checked.ok) {
      setErrors({ [checked.field.split(".")[0]!]: tidy(checked.message) });
      return;
    }
    setErrors({});
    save.mutate(draft);
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Name" error={errors.name}>
        <Input autoFocus placeholder="Database upgrade" value={v.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Starts" error={errors.startsAt}>
          <Input type="datetime-local" value={v.starts} onChange={(e) => set("starts", e.target.value)} />
        </Field>
        <Field label="Ends" error={errors.endsAt}>
          <Input type="datetime-local" value={v.ends} onChange={(e) => set("ends", e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Repeats">
          <Select
            label="Repeats"
            value={v.repeat}
            onValueChange={(r) => set("repeat", r)}
            options={[
              { value: "none", label: "Does not repeat" },
              { value: "daily", label: "Every day" },
              { value: "weekly", label: "Every week" },
            ]}
          />
        </Field>
        <Field label="Time zone" error={errors.recurrence}>
          <Select label="Time zone" value={v.timezone} onValueChange={(tz) => setV((c) => ({ ...c, timezone: tz }))} options={zones} />
        </Field>
      </div>
      {v.repeat === "weekly" ? (
        <FieldGroup legend="On" error={errors.recurrence}>
          <CheckboxList value={v.days} onValueChange={(days) => set("days", days)} options={WEEKDAYS} />
        </FieldGroup>
      ) : null}
      {v.repeat !== "none" ? (
        <Field label="Until" description="Leave empty to repeat until you delete it.">
          <Input type="date" value={v.until} onChange={(e) => set("until", e.target.value)} />
        </Field>
      ) : null}
      <FieldGroup legend="Monitors" description="Pick none to cover every monitor." error={errors.monitorIds}>
        <CheckboxList
          value={v.monitorIds}
          onValueChange={(ids) => set("monitorIds", ids)}
          options={(monitors.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
        />
      </FieldGroup>
      {errors.form ? (
        <p role="alert" className="text-small text-down">
          {errors.form}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {window ? "Save changes" : "Schedule"}
        </Button>
      </div>
    </form>
  );
}

function tidy(message: string): string {
  const text = message.includes(": ") ? message.slice(message.indexOf(": ") + 2) : message;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
