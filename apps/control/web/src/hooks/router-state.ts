import {
  buildRoutePathFromSchema,
  getRouteParentPath,
  parseRouteFromSchema,
} from "../app-route-schema.ts";
import type { RouteState } from "../types/index.ts";

function hasRouteStateField<K extends keyof RouteState>(
  state: Partial<RouteState>,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(state, key);
}

export function parseRoute(pathname: string, search = ""): RouteState {
  return parseRouteFromSchema(pathname, search);
}

export function normalizeNavigationState(
  previous: RouteState,
  nextState: Partial<RouteState>,
): RouteState {
  const nextView = nextState.view ?? previous.view;
  const merged = { ...previous, ...nextState, view: nextView };

  if (nextView === "storage") {
    const stayingInStorage = previous.view === "storage";
    const nextFilePathSpecified = hasRouteStateField(nextState, "filePath");
    const nextFileLineSpecified = hasRouteStateField(nextState, "fileLine");
    const filePath = nextFilePathSpecified
      ? nextState.filePath
      : stayingInStorage
      ? previous.filePath
      : undefined;
    const storagePath = nextState.storagePath ??
      (filePath
        ? getRouteParentPath(filePath)
        : stayingInStorage
        ? previous.storagePath
        : "/");

    return {
      ...merged,
      storagePath,
      filePath,
      fileLine: nextFileLineSpecified
        ? nextState.fileLine
        : stayingInStorage
        ? previous.fileLine
        : undefined,
      ref: undefined,
      threadId: undefined,
      runId: undefined,
      messageId: undefined,
    };
  }

  if (nextView === "chat") {
    const stayingInChat = previous.view === "chat";
    const nextThreadIdSpecified = hasRouteStateField(nextState, "threadId");
    const nextRunIdSpecified = hasRouteStateField(nextState, "runId");
    const nextMessageIdSpecified = hasRouteStateField(nextState, "messageId");
    return {
      ...merged,
      threadId: nextThreadIdSpecified
        ? nextState.threadId
        : stayingInChat
        ? previous.threadId
        : undefined,
      runId: nextRunIdSpecified
        ? nextState.runId
        : stayingInChat
        ? previous.runId
        : undefined,
      messageId: nextMessageIdSpecified
        ? nextState.messageId
        : stayingInChat
        ? previous.messageId
        : undefined,
      storagePath: undefined,
      filePath: undefined,
      fileLine: undefined,
      ref: undefined,
    };
  }

  if (nextView === "repo") {
    const stayingInRepo = previous.view === "repo";
    const nextFilePathSpecified = hasRouteStateField(nextState, "filePath");
    const nextFileLineSpecified = hasRouteStateField(nextState, "fileLine");
    const nextRefSpecified = hasRouteStateField(nextState, "ref");
    return {
      ...merged,
      filePath: nextFilePathSpecified
        ? nextState.filePath
        : stayingInRepo
        ? previous.filePath
        : undefined,
      fileLine: nextFileLineSpecified
        ? nextState.fileLine
        : stayingInRepo
        ? previous.fileLine
        : undefined,
      ref: nextRefSpecified
        ? nextState.ref
        : stayingInRepo
        ? previous.ref
        : undefined,
      storagePath: undefined,
      threadId: undefined,
      runId: undefined,
      messageId: undefined,
    };
  }

  return {
    ...merged,
    storagePath: undefined,
    filePath: undefined,
    fileLine: undefined,
    ref: undefined,
    threadId: undefined,
    runId: undefined,
    messageId: undefined,
  };
}

export function shouldPushHistory(
  currentPathname: string,
  currentSearch: string,
  nextPath: string,
): boolean {
  return `${currentPathname}${currentSearch}` !== nextPath;
}

export function buildPath(state: RouteState): string {
  return buildRoutePathFromSchema(state);
}
