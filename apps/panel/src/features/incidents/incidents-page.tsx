import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@tiny-uptime/ui/components/button";
import { CheckboxList } from "@tiny-uptime/ui/components/checkbox";
import { Dialog } from "@tiny-uptime/ui/components/dialog";
import { Field } from "@tiny-uptime/ui/components/field";
import { Input } from "@tiny-uptime/ui/components/input";
import { Select } from "@tiny-uptime/ui/components/select";
import { Section } from "@tiny-uptime/ui/components/surface";
import { Textarea } from "@tiny-uptime/ui/components/textarea";
import { notify } from "@tiny-uptime/ui/components/toast";
import { Megaphone } from "lucide-react";
import { useState } from "react";
import { api, ApiError, currentWorkspaceId, messageOf } from "../../lib/api";
import { monitorsQuery } from "../../lib/queries";
import { incidentsRoute } from "../../router";
import { PageHeader } from "../shell/page-header";
import { IncidentList } from "./incident-list";

export function IncidentsPage() {
  const { incident } = incidentsRoute.useSearch();
  return (
    <>
      <PageHeader
        title="Incidents"
        description="An incident opens when a monitor fails as many checks in a row as its rules allow, or misses a heartbeat, and resolves when it recovers."
        actions={<DeclareButton />}
      />
      <Section>
        <IncidentList
          showMonitor
          {...(incident ? { focusId: incident } : {})}
          emptyText="Nothing has gone down. Incidents appear here as soon as a monitor fails."
        />
      </Section>
    </>
  );
}

/**
 * Opens an incident by hand, for something no monitor sees, such as a slow payment provider. It
 * shows on status pages with the monitors it affects and sends no alerts.
 */
function DeclareButton() {
  const queryClient = useQueryClient();
  const monitors = useQuery(monitorsQuery());
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"down" | "slow">("down");
  const [monitorIds, setMonitorIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const declare = useMutation({
    meta: { inlineErrors: true },
    mutationFn: () => api.incidents.declare({ title, kind, monitorIds, message }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === currentWorkspaceId() });
      setOpen(false);
      setTitle("");
      setMessage("");
      setMonitorIds([]);
      notify("Incident declared", { description: "Status pages show it now.", type: "success" });
    },
    onError: (e) =>
      setError(e instanceof ApiError && e.field ? { field: e.field, message: e.message } : { field: "", message: messageOf(e) }),
  });
  const errorFor = (field: string) => (error?.field === field ? error.message : undefined);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Megaphone />
        Declare incident
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Declare an incident"
        description="For something no monitor sees. It shows on status pages right away and sends no alerts."
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            declare.mutate();
          }}
        >
          <Field label="Title" error={errorFor("title")}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Payments are slow" autoFocus />
          </Field>
          <Field label="Impact">
            <Select
              label="Impact"
              value={kind}
              onValueChange={setKind}
              options={[
                { value: "down", label: "Outage" },
                { value: "slow", label: "Degraded performance" },
              ]}
            />
          </Field>
          <Field label="Affects" description="With none ticked, it shows on every status page." error={errorFor("monitorIds")}>
            <CheckboxList
              value={monitorIds}
              onValueChange={setMonitorIds}
              options={(monitors.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>
          <Field label="What visitors read" error={errorFor("message")}>
            <Textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="We are looking into slow card payments."
            />
          </Field>
          {error && !["title", "monitorIds", "message"].includes(error.field) ? (
            <p className="text-small text-down">{error.message}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={declare.isPending}>
              Declare
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
