import { defineTools } from "./define-tools.ts";
import {
  CONTAINER_COMMIT,
  CONTAINER_START,
  CONTAINER_STATUS,
  CONTAINER_STOP,
  CREATE_REPOSITORY,
} from "./container/definitions.ts";
import { containerStartHandler } from "./container/handler-start.ts";
import { containerStatusHandler } from "./container/handler-status.ts";
import { containerCommitHandler } from "./container/handler-commit.ts";
import { containerStopHandler } from "./container/handler-stop.ts";
import { createRepositoryHandler } from "./container/handler-create-repository.ts";

export {
  CONTAINER_COMMIT,
  CONTAINER_START,
  CONTAINER_STATUS,
  CONTAINER_STOP,
  CREATE_REPOSITORY,
};

export {
  containerCommitHandler,
  containerStartHandler,
  containerStatusHandler,
  containerStopHandler,
  createRepositoryHandler,
};

export const { tools: CONTAINER_TOOLS, handlers: CONTAINER_HANDLERS } =
  defineTools([
    [CONTAINER_START, containerStartHandler],
    [CONTAINER_STATUS, containerStatusHandler],
    [CONTAINER_COMMIT, containerCommitHandler],
    [CONTAINER_STOP, containerStopHandler],
    [CREATE_REPOSITORY, createRepositoryHandler],
  ]);
