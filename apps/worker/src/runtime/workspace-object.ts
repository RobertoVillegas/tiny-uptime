import { DurableObject } from "cloudflare:workers";
import { Result } from "better-result";
import type {
  AlertPolicy,
  ChannelInput,
  ChannelPatch,
  IncidentUpdateInput,
  MaintenanceInput,
  MonitorInput,
  MonitorPatch,
  StatusPageInput,
  HistoryRange,
} from "@tiny-uptime/contracts";
import { toErrorData, workspace as ws, type Action, type AppError, type Principal } from "@tiny-uptime/core";
import { checker } from "../adapters/checks/checker";
import { createNotifier } from "../adapters/notify/notifier";
import { SqliteChannels, SqliteDeliveries } from "../adapters/sqlite/workspace/channels";
import { SqliteHistory } from "../adapters/sqlite/workspace/history";
import { SqliteIncidents } from "../adapters/sqlite/workspace/incidents";
import { SqliteMaintenance } from "../adapters/sqlite/workspace/maintenance";
import { SqliteMonitors } from "../adapters/sqlite/workspace/monitors";
import { SqliteIncidentUpdates, SqliteStatusPages } from "../adapters/sqlite/workspace/status-pages";
import { AlarmScheduler } from "../adapters/sqlite/workspace/scheduler";
import { SqliteApiKeys, SqliteWorkspaceInfo } from "../adapters/sqlite/workspace/workspace-info";
import { cryptoIds, systemClock } from "../adapters/system";
import type { Env } from "./env";
import { toWire, type Wire } from "./wire";

/**
 * One workspace: its own SQLite database and alarm. Every API method checks the caller first,
 * then runs one use case; the Worker turns the result into HTTP.
 */
export class Workspace extends DurableObject<Env> {
  private readonly d: ws.WorkspaceDeps;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this.d = {
      clock: systemClock,
      ids: cryptoIds,
      info: new SqliteWorkspaceInfo(sql),
      monitors: new SqliteMonitors(sql),
      incidents: new SqliteIncidents(sql),
      incidentUpdates: new SqliteIncidentUpdates(sql),
      statusPages: new SqliteStatusPages(sql),
      maintenance: new SqliteMaintenance(sql),
      history: new SqliteHistory(sql),
      channels: new SqliteChannels(sql),
      deliveries: new SqliteDeliveries(sql),
      apiKeys: new SqliteApiKeys(sql),
      checker,
      notifier: createNotifier(env),
      scheduler: new AlarmScheduler(sql, ctx.storage),
    };
  }

  // ---- operator and public entry points ----

  init(id: string, name: string): void {
    ws.initWorkspace(this.d, id, name);
  }

  async issueApiKey(name: string): Promise<string> {
    return (await ws.createApiKey(this.d, name)).key;
  }

  heartbeat(token: string): Promise<boolean> {
    return ws.recordHeartbeat(this.d, token);
  }

  publicStatus() {
    return ws.publicStatus(this.d);
  }

  /** A status page by id, or the workspace's legacy page of public monitors when id is null. */
  publicPage(pageId: string | null, days?: HistoryRange) {
    return pageId ? ws.publicStatusPage(this.d, pageId, days) : ws.legacyPublicPage(this.d, days);
  }

  override alarm(): Promise<void> {
    return ws.onAlarm(this.d);
  }

  // ---- API ----

  info(p: Principal) {
    return this.run(p, "read", () => Result.ok(this.d.info.get()!));
  }

  listMonitors(p: Principal, filter: { tag?: string } = {}) {
    return this.run(p, "read", () => Result.ok(ws.listMonitors(this.d, filter)));
  }

  getMonitor(p: Principal, id: string) {
    return this.run(p, "read", () => ws.getMonitor(this.d, id));
  }

  importMonitors(p: Principal, candidates: ws.ImportCandidate[], dryRun: boolean) {
    return this.run(p, "write", async () => {
      const rows = await ws.importMonitors(this.d, candidates, dryRun);
      const count = (status: string) => rows.filter((r) => r.status === status).length;
      return Result.ok({ dryRun, rows, created: count("created"), duplicates: count("duplicate"), invalid: count("invalid") });
    });
  }

  createMonitor(p: Principal, input: MonitorInput) {
    return this.run(p, "write", () => ws.createMonitor(this.d, input));
  }

  updateMonitor(p: Principal, id: string, patch: MonitorPatch) {
    return this.run(p, "write", () => ws.updateMonitor(this.d, id, patch));
  }

  deleteMonitor(p: Principal, id: string) {
    return this.run(p, "write", () => ws.deleteMonitor(this.d, id));
  }

  monitorsActivity(p: Principal) {
    return this.run(p, "read", () => Result.ok(ws.monitorsActivity(this.d)));
  }

  checkNow(p: Principal, id: string) {
    return this.run(p, "write", () => ws.checkNow(this.d, id));
  }

  monitorStats(p: Principal, id: string, hours: number) {
    return this.run(p, "read", () => ws.monitorStats(this.d, id, hours));
  }

  listIncidents(p: Principal, query: { limit?: number; monitorId?: string }) {
    return this.run(p, "read", () => Result.ok(ws.listIncidents(this.d, query)));
  }

  listIncidentUpdates(p: Principal, incidentId: string) {
    return this.run(p, "read", () => ws.listIncidentUpdates(this.d, incidentId));
  }

  postIncidentUpdate(p: Principal, incidentId: string, input: IncidentUpdateInput) {
    return this.run(p, "write", () => ws.postIncidentUpdate(this.d, incidentId, input, p));
  }

  listStatusPages(p: Principal) {
    return this.run(p, "read", () => Result.ok(ws.listStatusPages(this.d)));
  }

  getStatusPage(p: Principal, id: string) {
    return this.run(p, "read", () => ws.getStatusPage(this.d, id));
  }

  saveStatusPage(p: Principal, id: string, mode: "create" | "update", input: StatusPageInput) {
    return this.run(p, "write", () => ws.saveStatusPage(this.d, id, mode, input));
  }

  resetStatusPageHistory(p: Principal, id: string, reset: boolean) {
    return this.run(p, "write", () => ws.resetStatusPageHistory(this.d, id, reset));
  }

  deleteStatusPage(p: Principal, id: string) {
    return this.run(p, "write", () => ws.deleteStatusPage(this.d, id));
  }

  /** Whether the caller may change status pages, checked before claiming addresses in the directory. */
  canWrite(p: Principal) {
    return this.run(p, "write", () => Result.ok(true));
  }

  acknowledgeIncident(p: Principal, id: string) {
    return this.run(p, "write", () => ws.acknowledgeIncident(this.d, id, p));
  }

  listMaintenance(p: Principal) {
    return this.run(p, "read", () => Result.ok(ws.listMaintenance(this.d)));
  }

  createMaintenance(p: Principal, input: MaintenanceInput) {
    return this.run(p, "write", () => ws.createMaintenance(this.d, input));
  }

  updateMaintenance(p: Principal, id: string, input: MaintenanceInput) {
    return this.run(p, "write", () => ws.updateMaintenance(this.d, id, input));
  }

  deleteMaintenance(p: Principal, id: string) {
    return this.run(p, "write", () => ws.deleteMaintenance(this.d, id));
  }

  alertPolicy(p: Principal) {
    return this.run(p, "read", () => Result.ok(ws.getAlertPolicy(this.d)));
  }

  setAlertPolicy(p: Principal, policy: AlertPolicy) {
    return this.run(p, "write", () => ws.setAlertPolicy(this.d, policy));
  }

  listChannels(p: Principal) {
    return this.run(p, "read", () => Result.ok(ws.listChannels(this.d)));
  }

  createChannel(p: Principal, input: ChannelInput) {
    return this.run(p, "write", () => Result.ok(ws.createChannel(this.d, input)));
  }

  updateChannel(p: Principal, id: string, patch: ChannelPatch) {
    return this.run(p, "write", () => ws.updateChannel(this.d, id, patch));
  }

  deleteChannel(p: Principal, id: string) {
    return this.run(p, "write", () => ws.deleteChannel(this.d, id));
  }

  testChannel(p: Principal, id: string) {
    return this.run(p, "write", () => ws.testChannel(this.d, id));
  }

  listApiKeys(p: Principal) {
    return this.run(p, "manage-api-keys", () => Result.ok(ws.listApiKeys(this.d)));
  }

  createApiKey(p: Principal, name: string) {
    return this.run(p, "manage-api-keys", async () => Result.ok(await ws.createApiKey(this.d, name)));
  }

  deleteApiKey(p: Principal, id: string) {
    return this.run(p, "manage-api-keys", () => ws.deleteApiKey(this.d, id));
  }

  private async run<T>(
    principal: Principal,
    action: Action,
    useCase: () => Result<T, AppError> | Promise<Result<T, AppError>>,
  ): Promise<Wire<T>> {
    const allowed = ws.authorize(this.d, principal, action);
    if (allowed.isErr()) return { status: "error", error: toErrorData(allowed.error) };
    return toWire(await useCase());
  }
}
