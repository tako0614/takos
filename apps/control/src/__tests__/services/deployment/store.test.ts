import { assertEquals } from "jsr:@std/assert";
import {
  type DeploymentRow,
  deploymentStoreDeps,
  getDeploymentById,
  getDeploymentHistory,
  getServiceDeploymentBasics,
  toApiDeployment,
} from "@/services/deployment/store";

function createDrizzleMock(options: {
  selectOne?: unknown;
  selectAll?: unknown[];
}) {
  const terminal = {
    get: async () => options.selectOne,
    all: async () => options.selectAll ?? [],
    orderBy: () => terminal,
    limit: () => terminal,
    where: () => terminal,
  };

  return {
    select: () => ({
      from: () => terminal,
    }),
  };
}

Deno.test("toApiDeployment - maps deployment row to API deployment format", () => {
  const deploymentRow = {
    id: "dep-1",
    serviceId: "w-1",
    accountId: "space-1",
    version: 3,
    artifactRef: "worker-w-1-v3",
    bundleR2Key: "deployments/w-1/3/bundle.js",
    bundleHash: "sha256-abc",
    bundleSize: 5000,
    wasmR2Key: null,
    wasmHash: null,
    assetsManifest: null,
    runtimeConfigSnapshotJson: '{"compatibility_date":"2024-01-01"}',
    bindingsSnapshotEncrypted: null,
    envVarsSnapshotEncrypted: null,
    deployState: "completed",
    currentStep: null,
    stepError: null,
    status: "success",
    routingStatus: "active",
    routingWeight: 100,
    deployedBy: "user-1",
    deployMessage: "Fix bug",
    backendName: "workers-dispatch",
    targetJson: "{}",
    backendStateJson: "{}",
    idempotencyKey: "idem-1",
    isRollback: false,
    rollbackFromVersion: null,
    rolledBackAt: null,
    rolledBackBy: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
  } as unknown as DeploymentRow;

  const result = toApiDeployment(deploymentRow);

  assertEquals(result.id, "dep-1");
  assertEquals(result.service_id, "w-1");
  assertEquals(result.worker_id, undefined);
  assertEquals(result.space_id, "space-1");
  assertEquals(result.version, 3);
  assertEquals(result.artifact_ref, "worker-w-1-v3");
  assertEquals(result.bundle_r2_key, "deployments/w-1/3/bundle.js");
  assertEquals(result.bundle_hash, "sha256-abc");
  assertEquals(result.bundle_size, 5000);
  assertEquals(result.status, "success");
  assertEquals(result.routing_status, "active");
  assertEquals(result.routing_weight, 100);
  assertEquals(result.deployed_by, "user-1");
  assertEquals(result.deploy_message, "Fix bug");
  assertEquals(result.backend_name, "workers-dispatch");
  assertEquals(result.idempotency_key, "idem-1");
  assertEquals(result.is_rollback, false);
});

Deno.test("toApiDeployment - handles null dates", () => {
  const deploymentRow = {
    id: "dep-1",
    serviceId: "w-1",
    accountId: "space-1",
    version: 1,
    artifactRef: null,
    bundleR2Key: null,
    bundleHash: null,
    bundleSize: null,
    wasmR2Key: null,
    wasmHash: null,
    assetsManifest: null,
    runtimeConfigSnapshotJson: "{}",
    bindingsSnapshotEncrypted: null,
    envVarsSnapshotEncrypted: null,
    deployState: "pending",
    currentStep: null,
    stepError: null,
    status: "pending",
    routingStatus: "active",
    routingWeight: 100,
    deployedBy: null,
    deployMessage: null,
    backendName: "workers-dispatch",
    targetJson: "{}",
    backendStateJson: "{}",
    idempotencyKey: null,
    isRollback: false,
    rollbackFromVersion: null,
    rolledBackAt: null,
    rolledBackBy: null,
    startedAt: null,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as DeploymentRow;

  const result = toApiDeployment(deploymentRow);

  assertEquals(result.service_id, "w-1");
  assertEquals(result.rolled_back_at, null);
  assertEquals(result.completed_at, null);
  assertEquals(result.deployed_by, null);
});

Deno.test("getDeploymentById - returns null when deployment not found", async () => {
  deploymentStoreDeps.getDb = () =>
    createDrizzleMock({ selectOne: undefined }) as never;

  const result = await getDeploymentById({} as any, "nonexistent");

  assertEquals(result, null);
});

Deno.test("getDeploymentHistory - returns mapped deployments ordered by version desc", async () => {
  deploymentStoreDeps.getDb = () =>
    createDrizzleMock({
      selectAll: [
        {
          id: "dep-2",
          serviceId: "w-1",
          accountId: "space-1",
          version: 2,
          artifactRef: "worker-w-1-v2",
          bundleR2Key: null,
          bundleHash: null,
          bundleSize: null,
          wasmR2Key: null,
          wasmHash: null,
          assetsManifest: null,
          runtimeConfigSnapshotJson: "{}",
          bindingsSnapshotEncrypted: null,
          envVarsSnapshotEncrypted: null,
          deployState: "completed",
          currentStep: null,
          stepError: null,
          status: "success",
          routingStatus: "active",
          routingWeight: 100,
          deployedBy: null,
          deployMessage: null,
          backendName: "workers-dispatch",
          targetJson: "{}",
          backendStateJson: "{}",
          idempotencyKey: null,
          isRollback: false,
          rollbackFromVersion: null,
          rolledBackAt: null,
          rolledBackBy: null,
          startedAt: null,
          completedAt: null,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    }) as never;

  const result = await getDeploymentHistory({} as any, "w-1", 10);

  assertEquals(result.length, 1);
  assertEquals(result[0].id, "dep-2");
  assertEquals(result[0].version, 2);
});

Deno.test("getServiceDeploymentBasics - returns exists: false when worker not found", async () => {
  deploymentStoreDeps.getDb = () =>
    createDrizzleMock({ selectOne: undefined }) as never;

  const result = await getServiceDeploymentBasics({} as any, "nonexistent");

  assertEquals(result.exists, false);
  assertEquals(result.id, "nonexistent");
  assertEquals(result.hostname, null);
  assertEquals(result.activeDeploymentId, null);
});

Deno.test("getServiceDeploymentBasics - returns worker info when found", async () => {
  deploymentStoreDeps.getDb = () =>
    createDrizzleMock({
      selectOne: {
        id: "w-1",
        hostname: "test.example.com",
        activeDeploymentId: "dep-1",
        fallbackDeploymentId: null,
        activeDeploymentVersion: 3,
        workloadKind: "worker",
      },
    }) as never;

  const result = await getServiceDeploymentBasics({} as any, "w-1");

  assertEquals(result.exists, true);
  assertEquals(result.hostname, "test.example.com");
  assertEquals(result.activeDeploymentId, "dep-1");
});
