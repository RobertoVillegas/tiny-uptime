import type { Clock, Ids } from "../../ports/system";
import type {
  ApiKeyRepository,
  ChannelRepository,
  Checker,
  RegionalChecker,
  DeliveryRepository,
  HistoryRepository,
  IncidentRepository,
  IncidentUpdateRepository,
  MaintenanceRepository,
  MonitorRepository,
  Notifier,
  Scheduler,
  StatusPageRepository,
  WorkspaceInfoRepository,
} from "../../ports/workspace";

/** Everything a workspace's use cases need, built once per Durable Object. */
export type WorkspaceDeps = {
  clock: Clock;
  ids: Ids;
  info: WorkspaceInfoRepository;
  monitors: MonitorRepository;
  incidents: IncidentRepository;
  incidentUpdates: IncidentUpdateRepository;
  statusPages: StatusPageRepository;
  maintenance: MaintenanceRepository;
  history: HistoryRepository;
  channels: ChannelRepository;
  deliveries: DeliveryRepository;
  apiKeys: ApiKeyRepository;
  checker: Checker;
  regions: RegionalChecker;
  notifier: Notifier;
  scheduler: Scheduler;
};
