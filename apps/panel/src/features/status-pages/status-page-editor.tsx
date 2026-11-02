import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { STATUS_THEMES, StatusPageInput, validate, type StatusPage, type StatusPageDraft } from "@tiny-uptime/contracts";
import { Button, buttonVariants } from "@tiny-uptime/ui/components/button";
import { ConfirmDialog } from "@tiny-uptime/ui/components/dialog";
import { Field } from "@tiny-uptime/ui/components/field";
import { Textarea } from "@tiny-uptime/ui/components/textarea";
import { Input } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { Switch } from "@tiny-uptime/ui/components/switch";
import { notify } from "@tiny-uptime/ui/components/toast";
import { ArrowDown, ArrowUp, ChevronLeft, ExternalLink, Trash2, X } from "lucide-react";
import { useState } from "react";
import { ApiError, api, messageOf } from "../../lib/api";
import { monitorsQuery, statusPageQuery, statusPagesQuery } from "../../lib/queries";
import { statusPageRoute } from "../../router";
import { NotFound } from "../shell/not-found";

type Draft = Required<Pick<StatusPageDraft, "title" | "slug" | "description" | "theme" | "showLatency" | "hideBranding">> & {
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
  };
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

        {errors.form ? (
          <p role="alert" className="text-[0.8125rem] text-down">
            {errors.form}
          </p>
        ) : null}

        {page ? (
          <Section title="Danger zone">
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

function tidy(message: string): string {
  const text = message.includes(": ") ? message.slice(message.indexOf(": ") + 2) : message;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
