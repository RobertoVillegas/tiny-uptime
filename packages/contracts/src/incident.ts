export type Incident = {
  id: string;
  monitorId: string;
  monitorName: string | null;
  startedAt: string;
  resolvedAt: string | null;
  cause: string;
};

export const MAX_INCIDENTS_PAGE = 200;
