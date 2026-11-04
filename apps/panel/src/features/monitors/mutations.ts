import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MonitorDraft, MonitorPatch } from "@tiny-uptime/contracts";
import { notify } from "@tiny-uptime/ui/components/toast";
import { api, currentWorkspaceId } from "../../lib/api";

/** After any change, the workspace's monitor and incident queries refresh. */
function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === (currentWorkspaceId() ?? "none") });
}

export function useCreateMonitor() {
  const refresh = useRefresh();
  return useMutation({ meta: { inlineErrors: true }, mutationFn: (draft: MonitorDraft) => api.monitors.create(draft), onSuccess: refresh });
}

export function useUpdateMonitor(id: string) {
  const refresh = useRefresh();
  return useMutation({
    meta: { inlineErrors: true },
    mutationFn: (changes: MonitorPatch) => api.monitors.update(id, changes),
    onSuccess: refresh,
  });
}

export function usePauseMonitor(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (paused: boolean) => api.monitors.update(id, { paused }),
    onSuccess: async (monitor) => {
      await refresh();
      notify(monitor.paused ? `${monitor.name} is paused` : `${monitor.name} is checking again`, { type: "success" });
    },
  });
}

/** Runs one check now and says what it found. */
export function useCheckNow(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => api.monitors.check(id),
    onSuccess: async (result) => {
      await refresh();
      const latency = result.latencyMs === null ? "" : ` in ${result.latencyMs} ms`;
      notify(result.ok ? `Check passed${latency}` : "Check failed", {
        type: result.ok ? "success" : "error",
        description: result.monitor.paused ? `${result.detail}. Paused, so it was not recorded.` : result.detail,
      });
    },
  });
}

export function useDeleteMonitor() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => api.monitors.remove(id), onSuccess: refresh });
}
