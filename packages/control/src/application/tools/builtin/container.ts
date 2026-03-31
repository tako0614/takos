import type { ToolHandler } from '../tool-definitions.ts';
import {
  CONTAINER_START,
  CONTAINER_STATUS,
  CONTAINER_COMMIT,
  CONTAINER_STOP,
  CREATE_REPOSITORY,
  CONTAINER_TOOLS,
} from './container/definitions.ts';
import { containerStartHandler } from './container/handler-start.ts';
import { containerStatusHandler } from './container/handler-status.ts';
import { containerCommitHandler } from './container/handler-commit.ts';
import { containerStopHandler } from './container/handler-stop.ts';
import { createRepositoryHandler } from './container/handler-create-repository.ts';

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
