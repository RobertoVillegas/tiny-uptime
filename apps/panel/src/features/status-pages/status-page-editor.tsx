import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  HISTORY_RANGES,
  STATUS_LANGUAGES,
  STATUS_THEMES,
  StatusPageInput,
  validate,
  type HistoryRange,
  type StatusPage,
  type StatusPageDraft,
} from "@tiny-uptime/contracts";
import { Button, buttonVariants } from "@tiny-uptime/ui/components/button";
import { CopyButton } from "@tiny-uptime/ui/components/copy-button";
import { ConfirmDialog } from "@tiny-uptime/ui/components/dialog";
import { Field } from "@tiny-uptime/ui/components/field";
import { Textarea } from "@tiny-uptime/ui/components/textarea";
import { Input } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { Switch } from "@tiny-uptime/ui/components/switch";
import { notify } from "@tiny-uptime/ui/components/toast";
import { ArrowDown, ArrowUp, ChevronLeft, ExternalLink, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { ApiError, api, messageOf } from "../../lib/api";
import { monitorsQuery, statusPageQuery, statusPagesQuery } from "../../lib/queries";
import { statusPageRoute } from "../../router";
import { NotFound } from "../shell/not-found";

type Draft = Required<
  Pick<StatusPageDraft, "title" | "slug" | "description" | "theme" | "language" | "timeZone" | "showLatency" | "hideBranding">
> & {
  historyDays: `${HistoryRange}`;
  incidentDays: `${HistoryRange}`;
  externalUrl: string;
  customDomain: string;
  okPct: string;
  warnPct: string;
  components: { monitorId: string; group: string }[];
};

function toDraft(page?: StatusPage): Draft {
  return {
    title: page?.title ?? "",
    slug: page?.slug ?? "",
    description: page?.description ?? "",
    theme: page?.theme ?? "auto",
    language: page?.language ?? "en",
    timeZone: page?.timeZone ?? browserZone(),
    historyDays: `${page?.historyDays ?? 90}`,
    incidentDays: `${page?.incidentDays ?? 14}`,
    showLatency: page?.showLatency ?? true,
    hideBranding: page?.hideBranding ?? false,
    externalUrl: page?.externalUrl ?? "",
    customDomain: page?.customDomain ?? "",
    okPct: String(page?.okPct ?? 99.9),
    warnPct: String(page?.warnPct ?? 98),
    components: page?.components.map((c) => ({ monitorId: c.monitorId, group: c.group })) ?? [],
  };
}

function toInput(d: Draft): StatusPageDraft {
  return {
    ...d,
    externalUrl: d.externalUrl.trim() || null,
    customDomain: d.customDomain.trim() || null,
    okPct: Number(d.okPct),
    warnPct: Number(d.warnPct),
    historyDays: Number(d.historyDays) as HistoryRange,
    incidentDays: Number(d.incidentDays) as HistoryRange,
  };
}

const RANGE_OPTIONS = HISTORY_RANGES.map((days) => ({
  value: `${days}` as const,
  label: days === 1 ? "24 hours, hour by hour" : `${days} days`,
}));

/** Every zone the browser knows, for the time zone field's suggestions. */
const ZONES = (() => {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
})();

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function StatusPageEditor() {
  const { pageId } = statusPageRoute.useParams();
  const creating = pageId === "new";
  const page = useQuery({ ...statusPageQuery(pageId), enabled: !creating });
  if (!creating && page.isError) return <NotFound />;
  if (!creating && !page.data) return <Skeleton className="h-64 w-full" />;
  return <Editor key={pageId} page={creating ? undefined : page.data} />;
}

function Editor({ page }: { page: StatusPage | undefined }) {
  const [draft, setDraft] = useState(() => toDraft(page));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const monitors = useQuery(monitorsQuery());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: statusPagesQuery().queryKey });

  const save = useMutation({
    meta: { inlineErrors: true },
    mutationFn: (input: StatusPageDraft) => (page ? api.statusPages.update(page.id, input) : api.statusPages.create(input)),
    onSuccess: async (saved) => {
      await refresh();
      notify(page ? "Status page saved" : "Status page published", { description: saved.url, type: "success" });
      if (!page) await navigate({ to: "/status-pages/$pageId", params: { pageId: saved.id } });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.field) setErrors({ [error.field.split(".")[0]!]: tidy(error.message) });
      else setErrors({ form: messageOf(error) });
    },
  });
  const reset = useMutation({
    mutationFn: (on: boolean) => (on ? api.statusPages.resetHistory(page!.id) : api.statusPages.undoReset(page!.id)),
    onSuccess: async (saved) => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: statusPageQuery(saved.id).queryKey });
      notify(saved.historyResetAt ? "History reset" : "Full history restored", { type: "success" });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.statusPages.remove(page!.id),
    onSuccess: async () => {
      await refresh();
      notify("Status page deleted");
      await navigate({ to: "/status-pages" });
    },
  });

  const submit = () => {
    const input = toInput(draft);
    const checked = validate(StatusPageInput, input);
    if (!checked.ok) return setErrors({ [checked.field.split(".")[0]!]: tidy(checked.message) });
    setErrors({});
    save.mutate(input);
  };

  const all = monitors.data ?? [];
  const name = (id: string) => all.find((m) => m.id === id)?.name ?? "Deleted monitor";
  const available = all.filter((m) => !draft.components.some((c) => c.monitorId === m.id));
  const move = (index: number, by: -1 | 1) => {
    const next = [...draft.components];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    set("components", next);
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Link to="/status-pages" className="mb-4 inline-flex items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        Status pages
      </Link>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">{page ? page.title : "New status page"}</h1>
        <div className="flex gap-2">
          {page ? (
            <a href={page.url} target="_blank" rel="noopener" className={buttonVariants({ variant: "secondary" })}>
              <ExternalLink />
              Open page
            </a>
          ) : null}
          <Button type="submit" variant="primary" loading={save.isPending}>
            {page ? "Save changes" : "Publish page"}
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        <Section title="Page">
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <Field label="Title" error={errors.title}>
              <Input autoFocus={!page} value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Acme status" />
            </Field>
            <Field label="Address" description={`${window.location.origin}/s/${draft.slug || "your-slug"}`} error={errors.slug}>
              <Input value={draft.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="acme" spellCheck={false} />
            </Field>
            <Field label="Description" className="sm:col-span-2" error={errors.description}>
              <Textarea
                rows={2}

                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
            <Field label="Link to your site" description="Shown as a link at the top." error={errors.externalUrl}>
              <Input
                type="url"
                inputMode="url"
                placeholder="https://example.com"
                value={draft.externalUrl}
                onChange={(e) => set("externalUrl", e.target.value)}
              />
            </Field>
            <Field
              label="Custom domain"
              description="Point it at this Worker as a Cloudflare Custom Domain; the page loads at its root."
              error={errors.customDomain}
            >
              <Input
                placeholder="status.example.com"
                spellCheck={false}
                value={draft.customDomain}
                onChange={(e) => set("customDomain", e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Monitors"
          description="Shown in this order, under their group names. Only names and statuses are public, never targets."
        >
          <div className="flex flex-col gap-3 p-5">
            {draft.components.length === 0 ? (
              <p className="text-muted-foreground">No monitors yet. Add the ones customers care about.</p>
            ) : null}
            {draft.components.map((c, i) => (
              <div key={c.monitorId} className="flex flex-wrap items-center gap-2 rounded-control border border-border p-2">
                <span className="min-w-32 flex-1 truncate px-1 font-medium">{name(c.monitorId)}</span>
                <Input
                  aria-label={`Group for ${name(c.monitorId)}`}
                  className="w-44 max-sm:flex-1"
                  value={c.group}
                  onChange={(e) =>
                    set(
                      "components",
                      draft.components.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)),
                    )
                  }
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
                  disabled={i === draft.components.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${name(c.monitorId)}`}
                  onClick={() =>
                    set(
                      "components",
                      draft.components.filter((_, j) => j !== i),
                    )
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
            {errors.components ? <p className="text-[0.8125rem] text-down">{errors.components}</p> : null}
            {available.length ? (
              <div className="max-w-sm">
                <Select
                  label="Add a monitor"
                  labelTrigger
                  value="none"
                  onValueChange={(id) =>
                    id !== "none" &&
                    set("components", [...draft.components, { monitorId: id, group: draft.components.at(-1)?.group ?? "Services" }])
                  }
                  options={[{ value: "none", label: "Add a monitor…" }, ...available.map((m) => ({ value: m.id, label: m.name }))]}
                />
              </div>
            ) : null}
          </div>
        </Section>

        <Section title="Language and history" description="What visitors read, in which time zone, and how far back the page looks.">
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <Field label="Language">
              <Select
                label="Language"
                value={draft.language}
                onValueChange={(language) => set("language", language)}
                options={STATUS_LANGUAGES.map((l) => ({ value: l, label: { en: "English", es: "Español" }[l] }))}
              />
            </Field>
            <Field
              label="Time zone"
              description="Daily bars split at midnight here. Visitors see times of day in their own zone when it is known."
              error={errors.timeZone}
            >
              <Input
                list="status-page-zones"
                spellCheck={false}
                placeholder="America/Mexico_City"
                value={draft.timeZone}
                onChange={(e) => set("timeZone", e.target.value)}
              />
              <datalist id="status-page-zones">
                {ZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </Field>
            <Field label="Bars show" description="Visitors can switch ranges; this is where the page opens.">
              <Select label="Bars show" value={draft.historyDays} onValueChange={(v) => set("historyDays", v)} options={RANGE_OPTIONS} />
            </Field>
            <Field label="Past incidents from the last">
              <Select
                label="Past incidents from the last"
                value={draft.incidentDays}
                onValueChange={(v) => set("incidentDays", v)}
                options={RANGE_OPTIONS.map((o) => (o.value === "1" ? { ...o, label: "24 hours" } : o))}
              />
            </Field>
          </div>
        </Section>

        <Section title="Appearance">
          <div className="flex flex-col gap-5 p-5">
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Theme">
                <Select
                  label="Theme"
                  value={draft.theme}
                  onValueChange={(theme) => set("theme", theme)}
                  options={STATUS_THEMES.map((t) => ({
                    value: t,
                    label: { auto: "Follow the visitor's system", light: "Light", dark: "Dark" }[t],
                  }))}
                />
              </Field>
              <Field label="Green at or above (%)" error={errors.okPct}>
                <Input inputMode="decimal" value={draft.okPct} onChange={(e) => set("okPct", e.target.value)} />
              </Field>
              <Field label="Amber at or above (%)" description="Red below." error={errors.warnPct}>
                <Input inputMode="decimal" value={draft.warnPct} onChange={(e) => set("warnPct", e.target.value)} />
              </Field>
            </div>
            <Switch label="Show response times" checked={draft.showLatency} onCheckedChange={(v) => set("showLatency", v)} />
            <Switch label="Hide “Powered by tiny-uptime”" checked={draft.hideBranding} onCheckedChange={(v) => set("hideBranding", v)} />
          </div>
        </Section>

        {page ? <BadgeSection page={page} /> : null}

        {errors.form ? (
          <p role="alert" className="text-[0.8125rem] text-down">
            {errors.form}
          </p>
        ) : null}

        {page ? (
          <Section title="Danger zone">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
              <p className="max-w-prose text-muted-foreground">
                {page.historyResetAt
                  ? `History starts ${new Date(page.historyResetAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. Earlier bars and incidents are hidden, not deleted.`
                  : "Resetting starts the bars and uptime over from this hour and hides older incidents. Nothing is deleted."}
              </p>
              <div className="flex gap-2">
                {page.historyResetAt ? (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={reset.isPending && !reset.variables}
                    onClick={() => reset.mutate(false)}
                  >
                    Show full history
                  </Button>
                ) : null}
                <ConfirmDialog
                  trigger={
                    <Button type="button" variant="secondary">
                      <RotateCcw />
                      Reset history
                    </Button>
                  }
                  title={`Reset the history of ${page.title}?`}
                  description="Visitors see bars and uptime from this hour on, and no incidents from before it. Monitors keep their history, and you can show it again here."
                  confirmLabel="Reset history"
                  pending={reset.isPending && reset.variables === true}
                  onConfirm={() => reset.mutate(true)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="text-muted-foreground">Deleting takes the page offline and frees its address.</p>
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="secondary" className="text-down">
                    <Trash2 />
                    Delete status page
                  </Button>
                }
                title={`Delete ${page.title}?`}
                description="Visitors get a not found page instead. Monitors and incidents stay."
                confirmLabel="Delete status page"
                pending={remove.isPending}
                onConfirm={() => remove.mutate()}
              />
            </div>
          </Section>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Snippets that embed the page's live status badge, linking to the page at its public address
 * (the custom domain when there is one). The preview loads from this origin, which the panel's
 * CSP allows; a custom domain may not be live yet.
 */
function BadgeSection({ page }: { page: StatusPage }) {
  const badge = `${page.url.replace(/\/$/, "")}/badge.svg`;
  const alt = `${page.title} status`;
  const snippets = [
    { name: "Markdown", text: `[![${markdownText(alt)}](${markdownUrl(badge)})](${markdownUrl(page.url)})` },
    { name: "HTML", text: `<a href="${html(page.url)}"><img src="${html(badge)}" alt="${html(alt)}"></a>` },
  ];
  return (
    <Section
      title="Status badge"
      description="Shows the page's current status in a README or on your site. Add ?label=… to the image URL to change the left side."
    >
      <div className="flex flex-col gap-4 p-5">
        <img src={`/s/${page.slug}/badge.svg`} alt={alt} className="h-5 self-start" />
        {snippets.map((s) => (
          <div key={s.name} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.8125rem] font-medium">{s.name}</span>
              <CopyButton text={s.text} variant="ghost" label={`Copy ${s.name}`} />
            </div>
            <code className="block rounded-control bg-subtle px-3 py-2.5 font-mono text-[0.8125rem] break-all">{s.text}</code>
          </div>
        ))}
      </div>
    </Section>
  );
}

function html(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function markdownText(text: string): string {
  return text.replace(/[\\[\]`*_<>]/g, (c) => `\\${c}`);
}

function markdownUrl(url: string): string {
  return url.replace(/[()<> ]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function tidy(message: string): string {
  const text = message.includes(": ") ? message.slice(message.indexOf(": ") + 2) : message;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
