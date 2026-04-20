import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals, assertRejects } from "jsr:@std/assert";

import type { DeploymentEnv } from "../../../../../packages/control/src/application/services/deployment/index.ts";
import {
  type DeploymentQueueMessage,
  handleDeploymentJob,
  handleDeploymentJobDlq,
  isValidDeploymentQueueMessage,
} from "../../../../../packages/control/src/runtime/queues/deploy-jobs.ts";
import {
  defaultAppPreinstallJobs,
  groupDeploymentSnapshots,
  groups,
} from "../../../../../packages/control/src/infra/db/index.ts";

type FakeDeploymentRow = unknown[] | null;

function validDeployMessage(): DeploymentQueueMessage {
  return {
    version: 1,
    type: "deployment",
    deploymentId: "deploy-1",
    timestamp: Date.now(),
  };
}

function validDefaultAppPreinstallMessage(
  overrides: Partial<
    Extract<
      DeploymentQueueMessage,
      { type: "group_deployment_snapshot" }
    >
  > = {},
): DeploymentQueueMessage {
  return {
    version: 1,
    type: "group_deployment_snapshot",
    spaceId: "space-1",
    groupId: "group-1",
    groupName: "takos-docs",
    repositoryUrl: "https://example.com/takos-docs.git",
    ref: "main",
    refType: "branch",
    createdByAccountId: "account-1",
    reason: "default_app_preinstall",
    timestamp: Date.now(),
    ...overrides,
  };
}

function createDeploymentEnv(
  overrides: Partial<DeploymentEnv> = {},
): DeploymentEnv {
  return {
    DB: {} as D1Database,
    ENCRYPTION_KEY: "test-encryption-key",
    ADMIN_DOMAIN: "takos.test",
    HOSTNAME_ROUTING: {} as DeploymentEnv["HOSTNAME_ROUTING"],
    ROUTING_DO: {} as DeploymentEnv["ROUTING_DO"],
    WORKER_BUNDLES: undefined,
    ...overrides,
  } as DeploymentEnv;
}

function createFakeD1(
  deploymentRow: FakeDeploymentRow = null,
  preinstallJobRow: Record<string, unknown> | null = null,
): {
  db: D1Database;
  prepareCalls: Array<{ sql: string; args: unknown[] }>;
} {
  const prepareCalls: Array<{ sql: string; args: unknown[] }> = [];

  const db = {
    prepare(sql: string) {
      const normalized = sql.trim().toLowerCase();
      const selectedObject = normalized.startsWith("select")
        ? normalized.includes("default_app_preinstall_jobs")
          ? preinstallJobRow
          : rowToObject(deploymentRow)
        : null;
      const selectedRaw = normalized.startsWith("select")
        ? normalized.includes("default_app_preinstall_jobs")
          ? preinstallJobToRaw(preinstallJobRow)
          : deploymentRow
        : null;

      return {
        bind(..._args: unknown[]) {
          prepareCalls.push({ sql, args: _args });
          return {
            get: async () => selectedObject,
            first: async () => selectedObject,
            all: async () => ({
              results: selectedObject ? [selectedObject] : [],
            }),
            raw: async () => (selectedRaw ? [selectedRaw] : []),
            run: async () => ({ success: true, meta: { changes: 1 } }),
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, prepareCalls };
}

function preinstallJobToRaw(
  row: Record<string, unknown> | null,
): unknown[] | null {
  if (!row) return null;
  return [
    row.id,
    row.spaceId,
    row.createdByAccountId,
    row.distributionJson,
    row.expectedGroupIdsJson,
    row.deploymentQueuedAt,
    row.status,
    row.attempts,
    row.nextAttemptAt,
    row.lockedAt,
    row.lastError,
    row.createdAt,
    row.updatedAt,
  ];
}

function createFakeGroupDb(
  groupRow: Record<string, unknown> | null,
  options: {
    preinstallJobRow?: Record<string, unknown> | null;
    snapshotRow?: Record<string, unknown> | null;
    updateChanges?: number | null;
  } = {},
): {
  db: D1Database;
  updates: Array<{ table: unknown; values: Record<string, unknown> }>;
} {
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const preinstallJobRow = "preinstallJobRow" in options
    ? options.preinstallJobRow
    : defaultPreinstallJobRow();
  const snapshotRow = "snapshotRow" in options ? options.snapshotRow : null;
  const db = {
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                get: async () =>
                  table === defaultAppPreinstallJobs
                    ? preinstallJobRow
                    : table === groupDeploymentSnapshots
                    ? snapshotRow
                    : groupRow,
                all: async () => {
                  const row = table === defaultAppPreinstallJobs
                    ? preinstallJobRow
                    : table === groupDeploymentSnapshots
                    ? snapshotRow
                    : groupRow;
                  return row ? [row] : [];
                },
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              return {
                run: async () => {
                  updates.push({ table, values });
                  return options.updateChanges === null ? { success: true } : {
                    success: true,
                    meta: { changes: options.updateChanges ?? 1 },
                  };
                },
              };
            },
          };
        },
      };
    },
    insert() {},
    delete() {},
  } as unknown as D1Database;

  return { db, updates };
}

function defaultPreinstallJobRow(): Record<string, unknown> {
  return {
    id: "default-app-preinstall:space-1",
    spaceId: "space-1",
    distributionJson: null,
    expectedGroupIdsJson: null,
    deploymentQueuedAt: null,
  };
}

function rowToObject(row: FakeDeploymentRow): Record<string, unknown> | null {
  if (!row) return null;
  return {
    id: row[0],
    serviceId: row[1],
    spaceId: row[2],
    version: row[3],
    artifactRef: row[4],
    bundleR2Key: row[5],
    bundleHash: row[6],
    bundleSize: row[7],
    wasmR2Key: row[8],
    wasmHash: row[9],
    assetsManifest: row[10],
    runtimeConfigSnapshotJson: row[11],
    bindingsSnapshotEncrypted: row[12],
    envVarsSnapshotEncrypted: row[13],
    deployState: row[14],
    currentStep: row[15],
    stepError: row[16],
    status: row[17],
    routingStatus: row[18],
    routingWeight: row[19],
    deployedBy: row[20],
    deployMessage: row[21],
    backendName: row[22],
    targetJson: row[23],
    backendStateJson: row[24],
    artifactKind: row[25],
    idempotencyKey: row[26],
    isRollback: row[27],
    rollbackFromVersion: row[28],
    rolledBackAt: row[29],
    rolledBackBy: row[30],
    startedAt: row[31],
    completedAt: row[32],
    createdAt: row[33],
    updatedAt: row[34],
  };
}

function createDeploymentRow(
  overrides: Partial<{
    status: string;
    deployState: string;
  }> = {},
): unknown[] {
  return [
    "deploy-1",
    "service-1",
    "space-1",
    1,
    "artifact-1",
    null,
    null,
    null,
    null,
    null,
    null,
    "{}",
    null,
    null,
    overrides.deployState ?? "pending",
    null,
    null,
    overrides.status ?? "pending",
    "active",
    100,
    "user-1",
    null,
    "runtime-host",
    "{}",
    "{}",
    "worker-bundle",
    null,
    false,
    null,
    null,
    null,
    null,
    null,
    "2026-04-01T00:00:00.000Z",
    "2026-04-01T00:00:00.000Z",
  ];
}

Deno.test("isValidDeploymentQueueMessage - accepts valid messages", () => {
  assertEquals(isValidDeploymentQueueMessage(validDeployMessage()), true);
});

Deno.test("isValidDeploymentQueueMessage - rejects invalid messages", () => {
  assertEquals(isValidDeploymentQueueMessage(null), false);
  assertEquals(
    isValidDeploymentQueueMessage({ ...validDeployMessage(), version: 2 }),
    false,
  );
  assertEquals(
    isValidDeploymentQueueMessage({ ...validDeployMessage(), type: "job" }),
    false,
  );
});

Deno.test("handleDeploymentJob - fails closed when ENCRYPTION_KEY is missing", async () => {
  const env = createDeploymentEnv({ ENCRYPTION_KEY: undefined });

  await assertRejects(
    () => handleDeploymentJob(validDeployMessage(), env),
    Error,
    "ENCRYPTION_KEY must be set for deployment service",
  );
});

Deno.test("handleDeploymentJobDlq - marks an in-progress deployment as failed", async () => {
  const { db, prepareCalls } = createFakeD1(
    createDeploymentRow({ status: "in_progress" }),
  );
  const env = createDeploymentEnv({ DB: db });

  await handleDeploymentJobDlq(validDeployMessage(), env, 5);

  assertEquals(
    prepareCalls.some((call) =>
      call.sql.toLowerCase().includes('update "deployments"')
    ),
    true,
  );
});

Deno.test("handleDeploymentJobDlq - skips already successful deployments", async () => {
  const { db, prepareCalls } = createFakeD1(
    createDeploymentRow({ status: "success" }),
  );
  const env = createDeploymentEnv({ DB: db });

  await handleDeploymentJobDlq(validDeployMessage(), env, 3);

  assertEquals(
    prepareCalls.some((call) =>
      call.sql.toLowerCase().includes('update "deployments"')
    ),
    false,
  );
});

Deno.test("handleDeploymentJobDlq - rethrows when deployment lookup fails", async () => {
  const db = {
    prepare(sql: string) {
      const normalized = sql.trim().toLowerCase();
      return {
        bind() {
          return {
            get: async () => {
              if (normalized.startsWith("select")) {
                throw new Error("db read failed");
              }
              return null;
            },
            first: async () => {
              if (normalized.startsWith("select")) {
                throw new Error("db read failed");
              }
              return null;
            },
            all: async () => {
              if (normalized.startsWith("select")) {
                throw new Error("db read failed");
              }
              return { results: [] };
            },
            raw: async () => {
              if (normalized.startsWith("select")) {
                throw new Error("db read failed");
              }
              return [];
            },
            run: async () => {
              if (normalized.includes('update "deployments"')) {
                return { success: true, meta: { changes: 1 } };
              }
              throw new Error("db read failed");
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  const env = createDeploymentEnv({ DB: db });

  await assertRejects(
    () => handleDeploymentJobDlq(validDeployMessage(), env, 1),
    Error,
  );
});

Deno.test("handleDeploymentJobDlq - marks default app preinstall job failed", async () => {
  const { db, prepareCalls } = createFakeD1(
    null,
    {
      id: "default-app-preinstall:space-1",
      expectedGroupIdsJson: null,
      distributionJson: null,
    },
  );
  const env = createDeploymentEnv({ DB: db });

  await handleDeploymentJobDlq(validDefaultAppPreinstallMessage(), env, 5);

  const preinstallUpdate = prepareCalls.find((call) =>
    call.sql.toLowerCase().includes('update "default_app_preinstall_jobs"')
  );
  assertEquals(preinstallUpdate !== undefined, true);
  assertEquals(preinstallUpdate?.args.includes("failed"), true);
  assertEquals(
    preinstallUpdate?.args.includes("default-app-preinstall:space-1"),
    true,
  );
});

Deno.test("handleDeploymentJobDlq - leaves non-default-app group jobs out of preinstall state", async () => {
  const { db, prepareCalls } = createFakeD1();
  const env = createDeploymentEnv({ DB: db });

  await handleDeploymentJobDlq(
    validDefaultAppPreinstallMessage({ reason: undefined }),
    env,
    5,
  );

  assertEquals(
    prepareCalls.some((call) =>
      call.sql.toLowerCase().includes('update "default_app_preinstall_jobs"')
    ),
    false,
  );
});

Deno.test("handleDeploymentJob - marks already-applied default app preinstall completed", async () => {
  const { db, updates } = createFakeGroupDb({
    id: "group-1",
    spaceId: "space-1",
    name: "takos-docs",
    sourceKind: "git_ref",
    sourceRepositoryUrl: "https://example.com/takos-docs.git",
    sourceRef: "main",
    sourceRefType: "branch",
    currentGroupDeploymentSnapshotId: "snapshot-1",
    backendStateJson: JSON.stringify({
      defaultAppDistribution: { preinstalled: true },
    }),
  }, {
    snapshotRow: {
      id: "snapshot-1",
      spaceId: "space-1",
      groupId: "group-1",
      sourceKind: "git_ref",
      sourceRepositoryUrl: "https://example.com/takos-docs.git",
      sourceRef: "main",
      sourceRefType: "branch",
      status: "applied",
    },
  });
  const env = createDeploymentEnv({ DB: db });

  await handleDeploymentJob(validDefaultAppPreinstallMessage(), env);

  const preinstallUpdate = updates.find((update) =>
    update.table === defaultAppPreinstallJobs
  );
  assertEquals(preinstallUpdate?.values.status, "completed");
  assertEquals(preinstallUpdate?.values.lastError, null);
});

Deno.test("handleDeploymentJob - marks stale default app preinstall jobs failed before completion", async () => {
  const { db, updates } = createFakeGroupDb({
    id: "group-1",
    spaceId: "space-1",
    name: "takos-docs",
    sourceKind: "git_ref",
    sourceRepositoryUrl: "https://example.com/takos-docs.git",
    sourceRef: "main",
    sourceRefType: "branch",
    currentGroupDeploymentSnapshotId: "snapshot-1",
    backendStateJson: JSON.stringify({
      defaultAppDistribution: { preinstalled: true },
    }),
  });
  const env = createDeploymentEnv({ DB: db });

  await handleDeploymentJob(
    validDefaultAppPreinstallMessage({
      repositoryUrl: "https://example.com/other-app.git",
    }),
    env,
  );

  const preinstallUpdate = updates.find((update) =>
    update.table === defaultAppPreinstallJobs
  );
  assertEquals(preinstallUpdate?.values.status, "failed");
  assertEquals(
    String(preinstallUpdate?.values.lastError ?? "").includes(
      "Stale group deployment job",
    ),
    true,
  );
});

Deno.test("handleDeploymentJob - ignores default app outcomes outside expected group ids", async () => {
  const { db, updates } = createFakeGroupDb({
    id: "group-1",
    spaceId: "space-1",
    name: "takos-docs",
    sourceKind: "git_ref",
    sourceRepositoryUrl: "https://example.com/takos-docs.git",
    sourceRef: "main",
    sourceRefType: "branch",
    currentGroupDeploymentSnapshotId: "snapshot-1",
    backendStateJson: JSON.stringify({
      defaultAppDistribution: { preinstalled: true },
    }),
  }, {
    preinstallJobRow: {
      ...defaultPreinstallJobRow(),
      expectedGroupIdsJson: JSON.stringify(["other-group"]),
    },
  });
  const env = createDeploymentEnv({ DB: db });

  await handleDeploymentJob(validDefaultAppPreinstallMessage(), env);

  assertEquals(
    updates.some((update) => update.table === defaultAppPreinstallJobs),
    false,
  );
});

Deno.test("handleDeploymentJob - ignores default app outcomes outside stored distribution snapshot", async () => {
  const { db, updates } = createFakeGroupDb({
    id: "group-1",
    spaceId: "space-1",
    name: "takos-docs",
    sourceKind: "git_ref",
    sourceRepositoryUrl: "https://example.com/takos-docs.git",
    sourceRef: "main",
    sourceRefType: "branch",
    currentGroupDeploymentSnapshotId: "snapshot-1",
    backendStateJson: JSON.stringify({
      defaultAppDistribution: { preinstalled: true },
    }),
  }, {
    preinstallJobRow: {
      ...defaultPreinstallJobRow(),
      distributionJson: JSON.stringify([{
        name: "other-docs",
        repositoryUrl: "https://example.com/other-docs.git",
        ref: "main",
        refType: "branch",
      }]),
    },
  });
  const env = createDeploymentEnv({ DB: db });

  await handleDeploymentJob(validDefaultAppPreinstallMessage(), env);

  assertEquals(
    updates.some((update) => update.table === defaultAppPreinstallJobs),
    false,
  );
});

Deno.test("handleDeploymentJob - skips group snapshot when conditional claim affects no rows", async () => {
  const { db, updates } = createFakeGroupDb({
    id: "group-1",
    spaceId: "space-1",
    name: "takos-docs",
    sourceKind: "git_ref",
    sourceRepositoryUrl: "https://example.com/takos-docs.git",
    sourceRef: "main",
    sourceRefType: "branch",
    reconcileStatus: "in_progress",
    currentGroupDeploymentSnapshotId: null,
    backendStateJson: JSON.stringify({
      defaultAppDistribution: { preinstalled: true },
    }),
  }, { updateChanges: 0 });
  const env = createDeploymentEnv({ DB: db });

  await handleDeploymentJob(validDefaultAppPreinstallMessage(), env);

  const groupUpdate = updates.find((update) => update.table === groups);
  assertEquals(groupUpdate?.values.reconcileStatus, "in_progress");
  assertEquals(
    updates.some((update) => update.table === defaultAppPreinstallJobs),
    false,
  );
});
