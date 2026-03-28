import type { ToolHandler } from '../tool-definitions';
import {
  CONTAINER_START,
  CONTAINER_STATUS,
  CONTAINER_COMMIT,
  CONTAINER_STOP,
  CREATE_REPOSITORY,
  CONTAINER_TOOLS,
} from './container/definitions';
import { containerStartHandler } from './container/handler-start';
import { containerStatusHandler } from './container/handler-status';
import { containerCommitHandler } from './container/handler-commit';
import { containerStopHandler } from './container/handler-stop';
import { createRepositoryHandler } from './container/handler-create-repository';

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
