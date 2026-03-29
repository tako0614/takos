export type {
  TakosState,
  ResourceState,
  WorkerState,
  ContainerState,
  ServiceState,
  RouteState,
} from './state-types.js';

export type {
  StateAccessOptions,
} from './state-file.js';

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
} from './state-file.js';

export {
  hasApiEndpoint,
  getDefaultSpaceId,
} from './api-client.js';

export type {
  DiffAction,
  DiffEntry,
  DiffResult,
} from './diff.js';

export {
  computeDiff,
  computeWorkerDiff,
} from './diff.js';

export {
  formatPlan,
} from './plan.js';

export type {
  RefreshChange,
  RefreshResult,
  RefreshableProvider,
} from './refresh.js';

export {
  refreshState,
} from './refresh.js';

export type {
  SyncAction,
  SyncResult,
} from './sync.js';

export {
  syncState,
} from './sync.js';
