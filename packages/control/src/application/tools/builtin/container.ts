import type { ToolHandler } from '../types';
import {
  CONTAINER_START,
  CONTAINER_STATUS,
  CONTAINER_COMMIT,
  CONTAINER_STOP,
  CREATE_REPOSITORY,
  CONTAINER_TOOLS,
} from './container/definitions';
import { containerStartHandler } from './container/handlers/start';
import { containerStatusHandler } from './container/handlers/status';
import { containerCommitHandler } from './container/handlers/commit';
import { containerStopHandler } from './container/handlers/stop';
import { createRepositoryHandler } from './container/handlers/create-repository';

export {
  CONTAINER_START,
  CONTAINER_STATUS,
  CONTAINER_COMMIT,
  CONTAINER_STOP,
  CREATE_REPOSITORY,
  CONTAINER_TOOLS,
};

export {
  containerStartHandler,
  containerStatusHandler,
  containerCommitHandler,
  containerStopHandler,
  createRepositoryHandler,
};

export const CONTAINER_HANDLERS: Record<string, ToolHandler> = {
  container_start: containerStartHandler,
  container_status: containerStatusHandler,
  container_commit: containerCommitHandler,
  container_stop: containerStopHandler,
  create_repository: createRepositoryHandler,
};
