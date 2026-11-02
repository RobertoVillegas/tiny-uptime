import type { Clock, Ids } from "../../ports/system";
import type {
  ApiKeyRepository,
  ChannelRepository,
  Checker,
  DeliveryRepository,
  HistoryRepository,
  IncidentRepository,
  MonitorRepository,
  Notifier,
  Scheduler,
  WorkspaceInfoRepository,
} from "../../ports/workspace";

/** Everything a workspace's use cases need, built once per Durable Object. */
export type WorkspaceDeps = {
  clock: Clock;
  ids: Ids;
  info: WorkspaceInfoRepository;
  monitors: MonitorRepository;
  incidents: IncidentRepository;
  history: HistoryRepository;
  channels: ChannelRepository;
  deliveries: DeliveryRepository;
  apiKeys: ApiKeyRepository;
  checker: Checker;
  notifier: Notifier;
  scheduler: Scheduler;
};
