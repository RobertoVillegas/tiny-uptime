import { useQuery } from "@tanstack/react-query";
import { Button } from "@tiny-uptime/ui/components/button";
import { Input } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { Section } from "@tiny-uptime/ui/components/surface";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { monitorsQuery } from "../../lib/queries";
import type { Draft } from "./status-page-draft";

type Component = Draft["components"][number];

/** The monitors a page lists, in order, each under a group name. */
export function ComponentsSection({
  value,
  onChange,
  error,
}: {
  value: Component[];
  onChange: (next: Component[]) => void;
  error: string | undefined;
}) {
  const monitors = useQuery(monitorsQuery());
  const all = monitors.data ?? [];
  const name = (id: string) => all.find((m) => m.id === id)?.name ?? "Deleted monitor";
  const available = all.filter((m) => !value.some((c) => c.monitorId === m.id));
  const move = (index: number, by: -1 | 1) => {
    const next = value.filter((_, j) => j !== index);
    next.splice(index + by, 0, value[index]!);
    onChange(next);
  };

  return (
    <Section
      title="Monitors"
      description="Shown in this order, under their group names. Only names and statuses are public, never targets."
    >
      <div className="flex flex-col gap-3 p-5">
        {value.length === 0 ? <p className="text-muted-foreground">No monitors yet. Add the ones customers care about.</p> : null}
        {value.map((c, i) => (
          <div key={c.monitorId} className="flex flex-wrap items-center gap-2 rounded-control border border-border p-2">
            <span className="min-w-32 flex-1 truncate px-1 font-medium">{name(c.monitorId)}</span>
            <Input
              aria-label={`Group for ${name(c.monitorId)}`}
              className="w-44 max-sm:flex-1"
              value={c.group}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Move ${name(c.monitorId)} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Move ${name(c.monitorId)} down`}
              disabled={i === value.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${name(c.monitorId)}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          </div>
        ))}
        {error ? <p className="text-small text-down">{error}</p> : null}
        {available.length ? (
          <div className="max-w-sm">
            <Select
              label="Add a monitor"
              labelTrigger
              value="none"
              onValueChange={(id) => id !== "none" && onChange([...value, { monitorId: id, group: value.at(-1)?.group ?? "Services" }])}
              options={[{ value: "none", label: "Add a monitor…" }, ...available.map((m) => ({ value: m.id, label: m.name }))]}
            />
          </div>
        ) : null}
      </div>
    </Section>
  );
}
