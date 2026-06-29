export { asRunRow, runRowToApi } from "../../../shared/types/runs.ts";
export type { RunRow } from "../../../shared/types/runs.ts";

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
