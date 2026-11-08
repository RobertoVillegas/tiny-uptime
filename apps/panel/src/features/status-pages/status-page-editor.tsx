import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { STATUS_LANGUAGES, STATUS_THEMES, StatusPageInput, validate, type StatusPage, type StatusPageDraft } from "@tiny-uptime/contracts";
import { Button, buttonVariants } from "@tiny-uptime/ui/components/button";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { Section, Skeleton } from "@tiny-uptime/ui/components/surface";
import { Switch } from "@tiny-uptime/ui/components/switch";
import { Textarea } from "@tiny-uptime/ui/components/textarea";
import { notify } from "@tiny-uptime/ui/components/toast";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { useState } from "react";
import { ApiError, api, messageOf } from "../../lib/api";
import { fieldMessage } from "../../lib/forms";
import { statusPageQuery, statusPagesQuery } from "../../lib/queries";
import { statusPageRoute } from "../../router";
import { NotFound } from "../shell/not-found";
import { BadgeSection } from "./badge-section";
import { ComponentsSection } from "./components-section";
import { DangerZone } from "./danger-zone";
import { timezones } from "../../lib/zoned";
import { draftOf, inputOf, RANGE_OPTIONS, type Draft } from "./status-page-draft";

export function StatusPageEditor() {
  const { pageId } = statusPageRoute.useParams();
  const creating = pageId === "new";
  const page = useQuery({ ...statusPageQuery(pageId), enabled: !creating });
  if (!creating && page.isError) return <NotFound />;
  if (!creating && !page.data) return <Skeleton className="h-64 w-full" />;
  return <Editor key={pageId} page={creating ? undefined : page.data} />;
}

function Editor({ page }: { page: StatusPage | undefined }) {
  const [draft, setDraft] = useState(() => draftOf(page));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  /** Errors show under the top-level field, so `components.0.group` lands on the monitors list. */
  const showError = (field: string, message: string) => setErrors({ [field.split(".")[0] ?? field]: fieldMessage(field, message) });

  const save = useMutation({
    meta: { inlineErrors: true },
    mutationFn: (input: StatusPageDraft) => (page ? api.statusPages.update(page.id, input) : api.statusPages.create(input)),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: statusPagesQuery().queryKey });
      notify(page ? "Status page saved" : "Status page published", { description: saved.url, type: "success" });
      if (!page) await navigate({ to: "/status-pages/$pageId", params: { pageId: saved.id } });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.field) showError(error.field, error.message);
      else setErrors({ form: messageOf(error) });
    },
  });

  const submit = () => {
    const input = inputOf(draft);
    const checked = validate(StatusPageInput, input);
    if (!checked.ok) return showError(checked.field, checked.message);
    setErrors({});
    save.mutate(input);
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Link to="/status-pages" className="mb-4 inline-flex items-center gap-1 text-small text-muted-foreground hover:text-foreground">
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
              <Textarea rows={2} value={draft.description} onChange={(e) => set("description", e.target.value)} />
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

        <ComponentsSection value={draft.components} onChange={(next) => set("components", next)} error={errors.components} />

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
                {timezones().map((z) => (
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
          <p role="alert" className="text-small text-down">
            {errors.form}
          </p>
        ) : null}

        {page ? <DangerZone page={page} /> : null}
      </div>
    </form>
  );
}
