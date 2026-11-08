import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INCIDENT_UPDATE_STATUSES, type Incident, type IncidentUpdateStatus } from "@tiny-uptime/contracts";
import { Button } from "@tiny-uptime/ui/components/button";
import { Dialog } from "@tiny-uptime/ui/components/dialog";
import { Field } from "@tiny-uptime/ui/components/field";
import { Textarea } from "@tiny-uptime/ui/components/textarea";
import { Select } from "@tiny-uptime/ui/components/select";
import { Skeleton } from "@tiny-uptime/ui/components/surface";
import { Switch } from "@tiny-uptime/ui/components/switch";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { api, currentWorkspaceId, messageOf } from "../../lib/api";
import { dateTime } from "../../lib/format";
import { incidentUpdatesQuery } from "../../lib/queries";

const STATUS_LABEL: Record<IncidentUpdateStatus, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
  update: "Update",
};

/** An incident's timeline of notes, and a form to add one. Public notes appear on status pages and RSS. */
export function IncidentUpdatesDialog({ incident, canWrite }: { incident: Incident; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<IncidentUpdateStatus>("investigating");
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const updates = useQuery({ ...incidentUpdatesQuery(incident.id), enabled: open });
  const queryClient = useQueryClient();
  const post = useMutation({
    meta: { inlineErrors: true },
    mutationFn: () => api.incidents.postUpdate(incident.id, { status, body: body.trim(), visibility: internal ? "internal" : "public" }),
    onSuccess: async () => {
      setBody("");
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === currentWorkspaceId() && q.queryKey[1] === "incidents" });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <MessageSquarePlus />
          Updates
        </Button>
      }
      title={incident.monitorName ?? "Incident"}
      description={incident.cause}
    >
      <div className="flex flex-col gap-5">
        {updates.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : (updates.data ?? []).length === 0 ? (
          <p className="text-muted-foreground">
            No updates yet. Tell people what you know, even if it is only that you are looking into it.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {updates.data!.map((u) => (
              <li key={u.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
                <span className="text-small text-muted-foreground">
                  <b className="font-medium text-foreground">{STATUS_LABEL[u.status]}</b> · {dateTime(u.createdAt)}
                  {u.visibility === "internal" ? " · internal" : ""}
                </span>
                <p className="whitespace-pre-wrap">{u.body}</p>
              </li>
            ))}
          </ol>
        )}
        {canWrite ? (
          <form
            className="flex flex-col gap-4 border-t border-border pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) post.mutate();
            }}
          >
            <Field label="Status">
              <Select
                label="Status"
                value={status}
                onValueChange={setStatus}
                options={INCIDENT_UPDATE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              />
            </Field>
            <Field label="Message" error={post.isError ? messageOf(post.error) : undefined}>
              <Textarea
                rows={3}

                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={2000}
              />
            </Field>
            <Switch
              label="Internal note"
              description="Only your team sees it, not the status page."
              checked={internal}
              onCheckedChange={setInternal}
            />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={post.isPending} disabled={!body.trim()}>
                Post update
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Dialog>
  );
}
