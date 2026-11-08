import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { StatusPage } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { ConfirmDialog } from "@tiny-uptime/ui/components/dialog";
import { Section } from "@tiny-uptime/ui/components/surface";
import { notify } from "@tiny-uptime/ui/components/toast";
import { RotateCcw, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { hourOptions } from "../../lib/clock";
import { statusPageQuery, statusPagesQuery } from "../../lib/queries";

/** Resetting the page's history (and undoing it), and deleting the page. */
export function DangerZone({ page }: { page: StatusPage }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => queryClient.invalidateQueries({ queryKey: statusPagesQuery().queryKey });
  const reset = useMutation({
    mutationFn: (on: boolean) => (on ? api.statusPages.resetHistory(page.id) : api.statusPages.undoReset(page.id)),
    onSuccess: async (saved) => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: statusPageQuery(saved.id).queryKey });
      notify(saved.historyResetAt ? "History reset" : "Full history restored", { type: "success" });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.statusPages.remove(page.id),
    onSuccess: async () => {
      await refresh();
      notify("Status page deleted");
      await navigate({ to: "/status-pages" });
    },
  });

  return (
    <Section title="Danger zone">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <p className="max-w-prose text-muted-foreground">
          {page.historyResetAt
            ? `History starts ${new Date(page.historyResetAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", ...hourOptions() })}. Earlier bars and incidents are hidden, not deleted.`
            : "Resetting starts the bars and uptime over from this hour and hides older incidents. Nothing is deleted."}
        </p>
        <div className="flex gap-2">
          {page.historyResetAt ? (
            <Button type="button" variant="secondary" loading={reset.isPending && !reset.variables} onClick={() => reset.mutate(false)}>
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
            onConfirm={() => reset.mutateAsync(true)}
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
          onConfirm={() => remove.mutateAsync()}
        />
      </div>
    </Section>
  );
}
