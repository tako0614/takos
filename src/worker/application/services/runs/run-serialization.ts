export { asRunRow, runRowToApi } from "takos-api-contract/shared/types/runs";
export type { RunRow } from "takos-api-contract/shared/types/runs";

export type RunHierarchyNode = {
  id: string;
  threadId: string;
  accountId: string;
  parentRunId: string | null;
  rootThreadId: string | null;
  rootRunId: string | null;
};

export type SpaceModelLookup = {
  aiModel: string | null;
};

export type D1CountRow = {
  count: number | string;
};

export const runSelect = {
  id: true,
  threadId: true,
  spaceId: true,
  sessionId: true,
  parentRunId: true,
  childThreadId: true,
  rootThreadId: true,
  rootRunId: true,
  agentType: true,
  status: true,
  input: true,
  output: true,
  error: true,
  usage: true,
  serviceId: true,
  serviceHeartbeat: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} as const;
