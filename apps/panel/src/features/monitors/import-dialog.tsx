import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ImportReport, ImportRow, MonitorType } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { Dialog } from "@tiny-uptime/ui/components/dialog";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input } from "@tiny-uptime/ui/components/input";
import { Segmented } from "@tiny-uptime/ui/components/tabs";
import { notify } from "@tiny-uptime/ui/components/toast";
import { useState } from "react";
import { api, messageOf } from "../../lib/api";
import { monitorsQuery } from "../../lib/queries";
import { typeLabel } from "./describe";

type Source = "openuptime" | "file";

/** Copies monitors in from OpenUptime or an export file: a preview first, then the import itself. */
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [source, setSource] = useState<Source>("openuptime");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [file, setFile] = useState<{ name: string; monitors: Record<string, unknown>[] } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const queryClient = useQueryClient();

  const run = (dryRun: boolean) =>
    source === "openuptime"
      ? api.monitors.importOpenUptime({ url: url.trim(), apiKey: apiKey.trim(), dryRun })
      : api.monitors.importList(file!.monitors, dryRun);

  const check = useMutation({ meta: { inlineErrors: true }, mutationFn: () => run(true), onSuccess: setPreview });
  const commit = useMutation({
    meta: { inlineErrors: true },
    mutationFn: () => run(false),
    onSuccess: async (report) => {
      await queryClient.invalidateQueries({ queryKey: monitorsQuery().queryKey });
      notify(`${report.created} ${report.created === 1 ? "monitor" : "monitors"} imported`, {
        type: "success",
        description: report.duplicates ? `${report.duplicates} already here were skipped.` : undefined,
      });
      close();
    },
  });

  const close = () => {
    onOpenChange(false);
    setPreview(null);
    setApiKey("");
    check.reset();
    commit.reset();
  };

  const readFile = async (picked: File | undefined) => {
    setPreview(null);
    setFileError(null);
    setFile(null);
    if (!picked) return;
    try {
      const parsed = JSON.parse(await picked.text()) as unknown;
      const monitors = Array.isArray(parsed) ? parsed : (parsed as { monitors?: unknown }).monitors;
      if (!Array.isArray(monitors) || !monitors.length) throw new Error("no monitors");
      setFile({ name: picked.name, monitors: monitors as Record<string, unknown>[] });
    } catch {
      setFileError("This file is not a monitor export. Use one made with Export, or a JSON list of monitors.");
    }
  };

  const ready = preview?.rows.filter((r) => r.status === "ready").length ?? 0;
  const canPreview = source === "openuptime" ? url.trim() !== "" && apiKey.trim() !== "" : file !== null;
  const error = check.error ?? commit.error;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Import monitors"
      description="Monitors already here are skipped, so importing twice is safe. Nothing is created until you confirm."
      className="max-w-xl"
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (preview && ready) commit.mutate();
          else check.mutate();
        }}
      >
        <Segmented
          label="Import from"
          value={source}
          onValueChange={(next) => {
            setSource(next);
            setPreview(null);
          }}
          options={[
            { value: "openuptime", label: "OpenUptime" },
            { value: "file", label: "Export file" },
          ]}
        />
        {source === "openuptime" ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="OpenUptime address">
              <Input
                type="url"
                inputMode="url"
                placeholder="https://uptime.example.com"
                spellCheck={false}
                value={url}
                onChange={(e) => (setUrl(e.target.value), setPreview(null))}
              />
            </Field>
            <Field label="API key" description="Read once to list monitors, never stored.">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="ou_…"
                value={apiKey}
                onChange={(e) => (setApiKey(e.target.value), setPreview(null))}
              />
            </Field>
          </div>
        ) : (
          <Field
            label="Export file"
            description={file ? `${file.monitors.length} monitors in ${file.name}` : "A .json file from Export."}
            error={fileError ?? undefined}
          >
            <Input type="file" accept="application/json,.json" className="py-1.5" onChange={(e) => void readFile(e.target.files?.[0])} />
          </Field>
        )}

        {preview ? <PreviewList report={preview} /> : null}
        {error ? (
          <p role="alert" className="text-[0.8125rem] text-down">
            {messageOf(error)}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          {preview && ready ? (
            <Button type="submit" variant="primary" loading={commit.isPending}>
              Import {ready} {ready === 1 ? "monitor" : "monitors"}
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={!canPreview} loading={check.isPending}>
              Preview
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

const STATUS_TEXT: Record<ImportRow["status"], string> = {
  ready: "Will import",
  created: "Imported",
  duplicate: "Already here",
  invalid: "Cannot import",
};

function PreviewList({ report }: { report: ImportReport }) {
  const counts = (status: ImportRow["status"]) => report.rows.filter((r) => r.status === status).length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.8125rem] text-muted-foreground">
        {counts("ready")} to import · {counts("duplicate")} already here · {counts("invalid")} cannot be imported
      </p>
      <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-control border border-border">
        {report.rows.map((row, i) => (
          <li key={`${row.name}-${i}`} className="flex flex-col gap-0.5 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-medium">{row.name}</span>
              <span
                className={
                  row.status === "invalid" ? "shrink-0 text-[0.8125rem] text-down" : "shrink-0 text-[0.8125rem] text-muted-foreground"
                }
              >
                {STATUS_TEXT[row.status]}
              </span>
            </div>
            <span className="text-[0.8125rem] text-muted-foreground">
              {typeLabel(row.type as MonitorType) ?? row.type}
              {row.message && row.status === "invalid" ? ` · ${row.message}` : ""}
            </span>
            {row.notes.map((note) => (
              <span key={note} className="text-[0.8125rem] text-muted-foreground">
                {note}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
