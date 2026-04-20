import { assertEquals, assertRejects } from "jsr:@std/assert";
import { getTableName } from "drizzle-orm";

import { handleDeploymentJob } from "../deploy-jobs.ts";
import { GroupDeploymentSnapshotService } from "../../../application/services/platform/group-deployment-snapshots.ts";
import type { DeploymentEnv } from "../../../application/services/deployment/index.ts";

function tableName(table: unknown): string | null {
  try {
    return getTableName(table as never);
  } catch {
    return null;
  }
}

function makeEnv(overrides: Partial<DeploymentEnv> = {}): DeploymentEnv {
  return {
    DB: {} as DeploymentEnv["DB"],
    ENCRYPTION_KEY: "test-encryption-key",
    ADMIN_DOMAIN: "admin.example.test",
    HOSTNAME_ROUTING: {} as DeploymentEnv["HOSTNAME_ROUTING"],
    ROUTING_DO: {} as DeploymentEnv["ROUTING_DO"],
    ...overrides,
  } as DeploymentEnv;
}

function buildDb(state: {
  groupRow: Record<string, unknown> | null;
  snapshotRow: Record<string, unknown> | null;
  jobRow: Record<string, unknown> | null;
  groupUpdates: Array<Record<string, unknown>>;
  jobUpdates: Array<Record<string, unknown>>;
}) {
  return {
    select: () => ({
      from: (table: unknown) => {
        const name = tableName(table);
        return {
          where: () => ({
            get: async () => {
              if (name === "groups") return state.groupRow;
              if (name === "group_deployment_snapshots") {
                return state.snapshotRow;
              }
              if (name === "default_app_preinstall_jobs") {
                return state.jobRow;
              }
              return null;
            },
            all: async () => {
              if (name === "groups" && state.groupRow) return [state.groupRow];
              if (name === "default_app_preinstall_jobs" && state.jobRow) {
                return [state.jobRow];
              }
              return [];
            },
          }),
        };
      },
    }),
    insert: () => ({
      values: () => ({
        run: async () => ({ success: true, meta: { changes: 1 } }),
        onConflictDoNothing: () => ({
          run: async () => ({ success: true, meta: { changes: 1 } }),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => ({
          run: async () => {
            const name = tableName(table);
            if (name === "groups" && state.groupRow) {
              Object.assign(state.groupRow, value);
              state.groupUpdates.push(value);
            }
            if (name === "default_app_preinstall_jobs" && state.jobRow) {
              Object.assign(state.jobRow, value);
              state.jobUpdates.push(value);
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    }),
  };
}

Deno.test("handleDeploymentJob completes default app jobs only when the current snapshot matches the expected source", async () => {
  const state = {
    groupRow: {
      id: "group-1",
      spaceId: "space-1",
      name: "operator-docs",
      sourceKind: "git_ref",
      sourceRepositoryUrl: "https://example.com/operator-docs.git",
      sourceRef: "main",
      sourceRefType: "branch",
      currentGroupDeploymentSnapshotId: "snapshot-1",
      backendStateJson: JSON.stringify({
        defaultAppDistribution: { preinstalled: true },
      }),
      reconcileStatus: "idle",
    },
    snapshotRow: {
      id: "snapshot-1",
      groupId: "group-1",
      spaceId: "space-1",
      sourceKind: "git_ref",
      sourceRepositoryUrl: "https://example.com/operator-docs.git",
      sourceRef: "main",
      sourceRefType: "branch",
      status: "applied",
    },
    jobRow: {
      id: "default-app-preinstall:space-1",
      spaceId: "space-1",
      createdByAccountId: "user-1",
      distributionJson: JSON.stringify([{
        name: "operator-docs",
        title: "Docs",
        repositoryUrl: "https://example.com/operator-docs.git",
        ref: "main",
        refType: "branch",
        preinstall: true,
      }]),
      expectedGroupIdsJson: JSON.stringify(["group-1"]),
      deploymentQueuedAt: "2026-01-01T00:00:00.000Z",
      status: "deployment_queued",
      attempts: 1,
      nextAttemptAt: null,
      lockedAt: null,
      lastError: null,
    },
    groupUpdates: [] as Array<Record<string, unknown>>,
    jobUpdates: [] as Array<Record<string, unknown>>,
  };
  const env = makeEnv({
    DB: buildDb(state) as unknown as DeploymentEnv["DB"],
  });

  await handleDeploymentJob({
    version: 1,
    type: "group_deployment_snapshot",
    spaceId: "space-1",
    groupId: "group-1",
    groupName: "operator-docs",
    repositoryUrl: "https://example.com/operator-docs.git",
    ref: "main",
    refType: "branch",
    createdByAccountId: "user-1",
    reason: "default_app_preinstall",
    timestamp: 1_700_000_000_000,
  }, env);

  assertEquals(state.groupUpdates.at(-1)?.reconcileStatus, "ready");
  assertEquals(state.jobUpdates.at(-1)?.status, "completed");
  assertEquals(
    String(state.groupUpdates.at(-1)?.backendStateJson).includes(
      '"deployJobStatus":"completed"',
    ),
    true,
  );
});

Deno.test("handleDeploymentJob fails preinstall when the current snapshot does not match the expected source", async () => {
  const state = {
    groupRow: {
      id: "group-1",
      spaceId: "space-1",
      name: "operator-docs",
      sourceKind: "git_ref",
      sourceRepositoryUrl: "https://example.com/operator-docs.git",
      sourceRef: "main",
      sourceRefType: "branch",
      currentGroupDeploymentSnapshotId: "snapshot-1",
      backendStateJson: JSON.stringify({
        defaultAppDistribution: { preinstalled: true },
      }),
      reconcileStatus: "idle",
    },
    snapshotRow: {
      id: "snapshot-1",
      groupId: "group-1",
      spaceId: "space-1",
      sourceKind: "git_ref",
      sourceRepositoryUrl: "https://example.com/other.git",
      sourceRef: "main",
      sourceRefType: "branch",
      status: "applied",
    },
    jobRow: {
      id: "default-app-preinstall:space-1",
      spaceId: "space-1",
      createdByAccountId: "user-1",
      distributionJson: JSON.stringify([{
        name: "operator-docs",
        title: "Docs",
        repositoryUrl: "https://example.com/operator-docs.git",
        ref: "main",
        refType: "branch",
        preinstall: true,
      }]),
      expectedGroupIdsJson: JSON.stringify(["group-1"]),
      deploymentQueuedAt: "2026-01-01T00:00:00.000Z",
      status: "deployment_queued",
      attempts: 1,
      nextAttemptAt: null,
      lockedAt: null,
      lastError: null,
    },
    groupUpdates: [] as Array<Record<string, unknown>>,
    jobUpdates: [] as Array<Record<string, unknown>>,
  };
  const env = makeEnv({
    DB: buildDb(state) as unknown as DeploymentEnv["DB"],
  });

  await handleDeploymentJob({
    version: 1,
    type: "group_deployment_snapshot",
    spaceId: "space-1",
    groupId: "group-1",
    groupName: "operator-docs",
    repositoryUrl: "https://example.com/operator-docs.git",
    ref: "main",
    refType: "branch",
    createdByAccountId: "user-1",
    reason: "default_app_preinstall",
    timestamp: 1_700_000_000_000,
  }, env);

  assertEquals(state.groupUpdates.length, 0);
  assertEquals(state.jobUpdates.length, 1);
  assertEquals(state.jobUpdates.at(-1)?.status, "failed");
  assertEquals(
    String(state.jobUpdates.at(-1)?.lastError).includes(
      "does not match default app preinstall job",
    ),
    true,
  );
});

Deno.test("handleDeploymentJob marks the group and preinstall job failed when deployment throws", async () => {
  const originalDeploy = GroupDeploymentSnapshotService.prototype.deploy;
  GroupDeploymentSnapshotService.prototype.deploy = async () => {
    throw new Error("boom");
  };

  const state = {
    groupRow: {
      id: "group-1",
      spaceId: "space-1",
      name: "operator-docs",
      sourceKind: "git_ref",
      sourceRepositoryUrl: "https://example.com/operator-docs.git",
      sourceRef: "main",
      sourceRefType: "branch",
      currentGroupDeploymentSnapshotId: null,
      backendStateJson: JSON.stringify({
        defaultAppDistribution: { preinstalled: true },
      }),
      reconcileStatus: "idle",
    },
    snapshotRow: null as Record<string, unknown> | null,
    jobRow: {
      id: "default-app-preinstall:space-1",
      spaceId: "space-1",
      createdByAccountId: "user-1",
      distributionJson: JSON.stringify([{
        name: "operator-docs",
        title: "Docs",
        repositoryUrl: "https://example.com/operator-docs.git",
        ref: "main",
        refType: "branch",
        preinstall: true,
      }]),
      expectedGroupIdsJson: JSON.stringify(["group-1"]),
      deploymentQueuedAt: "2026-01-01T00:00:00.000Z",
      status: "deployment_queued",
      attempts: 1,
      nextAttemptAt: null,
      lockedAt: null,
      lastError: null,
    },
    groupUpdates: [] as Array<Record<string, unknown>>,
    jobUpdates: [] as Array<Record<string, unknown>>,
  };
  const env = makeEnv({
    DB: buildDb(state) as unknown as DeploymentEnv["DB"],
  });

  try {
    await assertRejects(
      () =>
        handleDeploymentJob({
          version: 1,
          type: "group_deployment_snapshot",
          spaceId: "space-1",
          groupId: "group-1",
          groupName: "operator-docs",
          repositoryUrl: "https://example.com/operator-docs.git",
          ref: "main",
          refType: "branch",
          createdByAccountId: "user-1",
          reason: "default_app_preinstall",
          timestamp: 1_700_000_000_000,
        }, env),
      Error,
      "boom",
    );
  } finally {
    GroupDeploymentSnapshotService.prototype.deploy = originalDeploy;
  }

  assertEquals(state.groupUpdates.at(-1)?.reconcileStatus, "degraded");
  assertEquals(state.jobUpdates.at(-1)?.status, "failed");
  assertEquals(
    String(state.groupUpdates.at(-1)?.backendStateJson).includes(
      '"deployJobStatus":"failed"',
    ),
    true,
  );
});
