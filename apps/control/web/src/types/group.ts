export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface DeploymentGroup {
  id: string;
  spaceId: string;
  name: string;
  appVersion: string | null;
  env: string | null;
  sourceKind: string | null;
  sourceRepositoryUrl: string | null;
  sourceRef: string | null;
  sourceRefType: string | null;
  sourceCommitSha: string | null;
  currentGroupDeploymentSnapshotId: string | null;
  desiredSpecJson: JsonValue | null;
  reconcileStatus: string;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GroupInventoryItem = Record<string, unknown>;

export interface DeploymentGroupDetail extends DeploymentGroup {
  observed: JsonValue | null;
  inventory: {
    resources: GroupInventoryItem[];
    workloads: GroupInventoryItem[];
    routes: GroupInventoryItem[];
  };
}
