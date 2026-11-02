import { Section } from "@tiny-uptime/ui/components/surface";
import { PageHeader } from "../shell/page-header";
import { IncidentList } from "./incident-list";

export function IncidentsPage() {
  return (
    <>
      <PageHeader
        title="Incidents"
        description="An incident opens when a monitor fails as many checks in a row as its rules allow, or misses a heartbeat, and resolves when it recovers."
      />
      <Section>
        <IncidentList showMonitor emptyText="Nothing has gone down. Incidents appear here as soon as a monitor fails." />
      </Section>
    </>
  );
}
