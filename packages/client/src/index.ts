import type {
  AlertPolicy,
  ApiKey,
  Channel,
  ChannelDraft,
  ChannelPatch,
  CreatedApiKey,
  Incident,
  IncidentUpdate,
  IncidentUpdateInput,
  InviteInfo,
  Maintenance,
  MaintenanceDraft,
  Me,
  Member,
  Membership,
  Monitor,
  MonitorDraft,
  MonitorPatch,
  MonitorStats,
  PendingInvite,
  Role,
  SignInStage,
  StatusPage,
  StatusPageDraft,
  OAuthGrantDto,
} from "@tiny-uptime/contracts";
import { call, type Transport } from "./http";

export { ApiError, type Transport } from "./http";

type Challenge = { challengeId: string; challenge: string };
type Json = Record<string, unknown>;

/** A typed client for the tiny-uptime API, shared by the panel and future apps. */
export function createClient(t: Transport) {
  const get = <T>(path: string) => call<T>(t, "GET", path);
  const post = <T>(path: string, body: unknown = {}) => call<T>(t, "POST", path, body);
  const patch = <T>(path: string, body: unknown) => call<T>(t, "PATCH", path, body);
  const del = <T = void>(path: string) => call<T>(t, "DELETE", path);

  return {
    auth: {
      me: () => get<Me>("/auth/me"),
      logout: () => post<{ ok: true }>("/auth/logout"),
      loginOptions: () => post<Challenge>("/auth/login/options"),
      loginComplete: (challengeId: string, authentication: Json) =>
        post<{ stage: SignInStage }>("/auth/login/complete", { challengeId, authentication }),
      mfa: (code: string) => post<{ stage: "full" }>("/auth/mfa", { code }),
      recover: (email: string, code: string) => post<{ stage: "full"; addPasskey: true }>("/auth/recovery", { email, code }),
      invite: (token: string) => get<InviteInfo>(`/auth/invite?token=${encodeURIComponent(token)}`),
      inviteOptions: (token: string, name: string) =>
        post<Challenge & { user: { name: string; displayName: string } }>("/auth/invite/options", { token, name }),
      inviteComplete: (input: { token: string; name: string; challengeId: string; registration: Json; label?: string }) =>
        post<{ stage: "full"; recoveryCodes: string[] }>("/auth/invite/complete", input),
      acceptInvite: (token: string) => post<Membership>("/auth/invite/accept", { token }),
      passkeyOptions: () => post<Challenge & { user: { id: string; name: string; displayName: string } }>("/auth/passkeys/options"),
      addPasskey: (input: { challengeId: string; registration: Json; label?: string }) => post<{ ok: true }>("/auth/passkeys", input),
      removePasskey: (id: string) => del<{ ok: true }>(`/auth/passkeys/${encodeURIComponent(id)}`),
      totpSetup: () => post<{ secret: string; uri: string }>("/auth/totp/setup"),
      totpConfirm: (code: string) => post<{ ok: true }>("/auth/totp/confirm", { code }),
      totpDisable: (code: string) => post<{ ok: true }>("/auth/totp/disable", { code }),
      recoveryCodes: () => post<{ codes: string[] }>("/auth/recovery-codes"),
      endOtherSessions: () => del<{ ok: true }>("/auth/sessions/others"),
      connectedApps: () => get<OAuthGrantDto[]>("/auth/oauth-grants"),
      disconnectApp: (id: string) => del<{ ok: true }>(`/auth/oauth-grants/${encodeURIComponent(id)}`),
    },
    members: {
      list: (workspaceId: string) => get<{ members: Member[]; invites: PendingInvite[] }>(`/auth/workspaces/${workspaceId}/members`),
      invite: (workspaceId: string, email: string, role: Role) =>
        post<{ inviteUrl: string; email: string; role: Role }>(`/auth/workspaces/${workspaceId}/invites`, { email, role }),
      setRole: (workspaceId: string, userId: string, role: Role) =>
        patch<{ ok: true }>(`/auth/workspaces/${workspaceId}/members/${userId}`, { role }),
      remove: (workspaceId: string, userId: string) => del<{ ok: true }>(`/auth/workspaces/${workspaceId}/members/${userId}`),
    },
    monitors: {
      list: (filter: { tag?: string } = {}) =>
        get<Monitor[]>(`/api/v1/monitors${filter.tag ? `?tag=${encodeURIComponent(filter.tag)}` : ""}`),
      get: (id: string) => get<Monitor>(`/api/v1/monitors/${id}`),
      create: (draft: MonitorDraft) => post<Monitor>("/api/v1/monitors", draft),
      update: (id: string, changes: MonitorPatch) => patch<Monitor>(`/api/v1/monitors/${id}`, changes),
      remove: (id: string) => del(`/api/v1/monitors/${id}`),
      stats: (id: string, hours: number) => get<MonitorStats>(`/api/v1/monitors/${id}/stats?hours=${hours}`),
    },
    incidents: {
      list: (query: { limit?: number; monitorId?: string } = {}) => {
        const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
        return get<Incident[]>(`/api/v1/incidents${params.size ? `?${params}` : ""}`);
      },
      acknowledge: (id: string) => post<{ ok: true }>(`/api/v1/incidents/${id}/acknowledge`),
      updates: (id: string) => get<IncidentUpdate[]>(`/api/v1/incidents/${id}/updates`),
      postUpdate: (id: string, update: Partial<IncidentUpdateInput> & { body: string }) =>
        post<IncidentUpdate>(`/api/v1/incidents/${id}/updates`, update),
    },
    statusPages: {
      list: () => get<StatusPage[]>("/api/v1/status-pages"),
      get: (id: string) => get<StatusPage>(`/api/v1/status-pages/${id}`),
      create: (draft: StatusPageDraft) => post<StatusPage>("/api/v1/status-pages", draft),
      update: (id: string, draft: StatusPageDraft) => patch<StatusPage>(`/api/v1/status-pages/${id}`, draft),
      remove: (id: string) => del(`/api/v1/status-pages/${id}`),
    },
    maintenance: {
      list: () => get<Maintenance[]>("/api/v1/maintenance"),
      create: (draft: MaintenanceDraft) => post<Maintenance>("/api/v1/maintenance", draft),
      update: (id: string, draft: MaintenanceDraft) => patch<Maintenance>(`/api/v1/maintenance/${id}`, draft),
      remove: (id: string) => del(`/api/v1/maintenance/${id}`),
    },
    alertPolicy: {
      get: () => get<AlertPolicy>("/api/v1/alert-policy"),
      set: (policy: AlertPolicy) => patch<AlertPolicy>("/api/v1/alert-policy", policy),
    },
    channels: {
      list: () => get<Channel[]>("/api/v1/channels"),
      create: (draft: ChannelDraft) => post<Channel>("/api/v1/channels", draft),
      update: (id: string, changes: ChannelPatch) => patch<Channel>(`/api/v1/channels/${id}`, changes),
      remove: (id: string) => del(`/api/v1/channels/${id}`),
      test: (id: string) => post<{ delivered: true }>(`/api/v1/channels/${id}/test`),
    },
    apiKeys: {
      list: () => get<ApiKey[]>("/api/v1/api-keys"),
      create: (name: string) => post<CreatedApiKey>("/api/v1/api-keys", { name }),
      remove: (id: string) => del(`/api/v1/api-keys/${id}`),
    },
  };
}

export type Client = ReturnType<typeof createClient>;
