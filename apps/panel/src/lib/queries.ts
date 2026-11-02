import { queryOptions } from "@tanstack/react-query";
import { api, currentWorkspaceId } from "./api";

/** Query keys include the workspace, so switching workspaces never shows another one's data. */
const ws = () => currentWorkspaceId() ?? "none";

export const meQuery = queryOptions({ queryKey: ["me"], queryFn: () => api.auth.me(), staleTime: 60_000, retry: false });

export const monitorsQuery = () =>
  queryOptions({ queryKey: [ws(), "monitors"], queryFn: () => api.monitors.list(), refetchInterval: 30_000 });
export const monitorQuery = (id: string) =>
  queryOptions({ queryKey: [ws(), "monitors", id], queryFn: () => api.monitors.get(id), refetchInterval: 30_000 });
export const statsQuery = (id: string, hours: number) =>
  queryOptions({ queryKey: [ws(), "monitors", id, "stats", hours], queryFn: () => api.monitors.stats(id, hours), refetchInterval: 60_000 });
export const incidentsQuery = (monitorId?: string) =>
  queryOptions({
    queryKey: [ws(), "incidents", monitorId ?? "all"],
    queryFn: () => api.incidents.list(monitorId ? { monitorId } : {}),
    refetchInterval: 30_000,
  });
export const channelsQuery = () => queryOptions({ queryKey: [ws(), "channels"], queryFn: () => api.channels.list() });
export const apiKeysQuery = () => queryOptions({ queryKey: [ws(), "api-keys"], queryFn: () => api.apiKeys.list() });
export const membersQuery = (workspaceId: string) =>
  queryOptions({ queryKey: [workspaceId, "members"], queryFn: () => api.members.list(workspaceId) });
export const maintenanceQuery = () =>
  queryOptions({ queryKey: [ws(), "maintenance"], queryFn: () => api.maintenance.list(), refetchInterval: 60_000 });
export const alertPolicyQuery = () => queryOptions({ queryKey: [ws(), "alert-policy"], queryFn: () => api.alertPolicy.get() });
