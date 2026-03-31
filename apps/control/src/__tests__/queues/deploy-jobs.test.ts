import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals, assertRejects } from "jsr:@std/assert";

import type { DeploymentEnv } from "../../../../../packages/control/src/application/services/deployment/index.ts";
import {
  type DeploymentQueueMessage,
  handleDeploymentJob,
  handleDeploymentJobDlq,
  isValidDeploymentQueueMessage,
} from "../../../../../packages/control/src/runtime/queues/deploy-jobs.ts";

type FakeDeploymentRow = unknown[] | null;

function validDeployMessage(): DeploymentQueueMessage {
  return {
    version: 1,
    type: "deployment",
    deploymentId: "deploy-1",
    timestamp: Date.now(),
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
): {
  db: D1Database;
  prepareCalls: Array<{ sql: string; args: unknown[] }>;
} {
  const prepareCalls: Array<{ sql: string; args: unknown[] }> = [];

  const db = {
    prepare(sql: string) {
      const normalized = sql.trim().toLowerCase();
      const row = normalized.startsWith("select") ? deploymentRow : null;

      return {
        bind(..._args: unknown[]) {
          prepareCalls.push({ sql, args: _args });
          return {
            get: async () => rowToObject(row),
            first: async () => rowToObject(row),
            all: async () => ({ results: row ? [rowToObject(row)] : [] }),
            raw: async () => (row ? [row] : []),
            run: async () => ({ success: true, meta: { changes: 1 } }),
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, prepareCalls };
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
    providerName: row[22],
    targetJson: row[23],
    providerStateJson: row[24],
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
