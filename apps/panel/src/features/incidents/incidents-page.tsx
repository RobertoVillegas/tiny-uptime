import { Section } from "@tiny-uptime/ui/components/surface";
import { PageHeader } from "../shell/page-header";
import { IncidentList } from "./incident-list";

export function IncidentsPage() {
  return (
    <>
      <PageHeader
        title="Incidents"
        description="An incident opens after two failed checks in a row, or a missed heartbeat, and resolves on the next success."
      />
      <Section>
        <IncidentList showMonitor emptyText="Nothing has gone down. Incidents appear here as soon as a monitor fails." />
      </Section>
    </>
  );
}
