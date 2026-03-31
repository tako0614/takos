export type {
  TakosState,
  ResourceState,
  WorkerState,
  ContainerState,
  ServiceState,
  RouteState,
} from './state-types.ts';

export type {
  StateAccessOptions,
} from './state-file.ts';

export {
  readState,
  writeState,
  getStateDir,
  getStateFilePath,
  deleteStateFile,
  listStateGroups,
  // File-based fallback helpers (for tests / migration)
  readStateFromFile,
  writeStateToFile,
  deleteStateFromFile,
  listStateGroupsFromFile,
} from './state-file.ts';

export {
  hasApiEndpoint,
  getDefaultSpaceId,
} from './api-client.ts';

export type {
  DiffAction,
  DiffEntry,
  DiffResult,
} from './diff.ts';

export {
  computeDiff,
  computeWorkerDiff,
} from './diff.ts';

export {
  formatPlan,
} from './plan.ts';

export type {
  RefreshChange,
  RefreshResult,
  RefreshableProvider,
} from './refresh.ts';

export {
  refreshState,
} from './refresh.ts';

export type {
  SyncAction,
  SyncResult,
} from './sync.ts';

export {
  syncState,
} from './sync.ts';
