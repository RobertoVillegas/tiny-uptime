import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

/** Segmented tabs for views of the same thing, like 24 hours / 7 days / 30 days. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  label: string;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <TabsPrimitive.List aria-label={label} className="relative flex rounded-control bg-subtle p-0.5">
        {options.map((o) => (
          <TabsPrimitive.Tab
            key={o.value}
            value={o.value}
            className="relative z-10 h-7 rounded-[calc(var(--radius-control)-0.125rem)] px-2.5 text-small font-medium text-muted-foreground transition-colors duration-150 data-selected:text-foreground"
          >
            {o.label}
          </TabsPrimitive.Tab>
        ))}
        <TabsPrimitive.Indicator className="absolute top-0.5 left-(--active-tab-left) h-7 w-(--active-tab-width) rounded-[calc(var(--radius-control)-0.125rem)] bg-surface shadow-sm transition-[left,width] duration-200 ease-out" />
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
