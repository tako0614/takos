import { test } from "bun:test";
/**
 * Cancellation tests for the deployment pipeline.
 *
 * Focused on the phase-boundary AbortSignal checks added to
 * `executeDeploymentPipeline`. The earliest boundary (`lock`) fires before
 * any DB access, so we can verify cancellation without provisioning the
 * full DB harness used by other tests.
 */
import { assertEquals, assertRejects } from "@takos/test/assert";

import { executeDeploymentPipeline } from "../execute.ts";
import { DeploymentService } from "../service.ts";
import type { DeploymentEnv } from "../models.ts";
import { type DeploymentRow, deploymentStoreDeps } from "../store.ts";

const originalGetDb = deploymentStoreDeps.getDb;

function makeEnv(): DeploymentEnv {
  return {
    DB: {} as DeploymentEnv["DB"],
    ENCRYPTION_KEY: "test-encryption-key",
    ADMIN_DOMAIN: "admin.example.test",
    HOSTNAME_ROUTING: {} as DeploymentEnv["HOSTNAME_ROUTING"],
    ROUTING_DO: {} as DeploymentEnv["ROUTING_DO"],
  } as DeploymentEnv;
}

function makeDeploymentRow(
  overrides: Partial<DeploymentRow> = {},
): DeploymentRow {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "dep-db-cancelled",
    serviceId: "svc-1",
    accountId: "space-1",
    version: 1,
    artifactRef: "svc-1-v1",
    artifactKind: "worker-bundle",
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
    deployedBy: "user-1",
    deployMessage: null,
    backendName: "runtime-host",
    targetJson: "{}",
    backendStateJson: "{}",
    idempotencyKey: null,
    isRollback: false,
    rollbackFromVersion: null,
    rolledBackAt: null,
    rolledBackBy: null,
    startedAt: null,
    completedAt: null,
    cancellationRequestedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as DeploymentRow;
}

test("executeDeploymentPipeline throws at the lock phase boundary when signal is pre-aborted", async () => {
  const env = makeEnv();
  const controller = new AbortController();
  controller.abort("user-cancelled");

  // The lock check fires before any DB access. Trap getDb so the test fails
  // loudly if cancellation does not short-circuit before DB use.
  let dbAccessed = false;
  deploymentStoreDeps.getDb = (() => {
    dbAccessed = true;
    throw new Error("db should not be accessed after cancellation");
  }) as typeof deploymentStoreDeps.getDb;

  try {
    await assertRejects(
      () =>
        executeDeploymentPipeline(
          env,
          "test-encryption-key",
          "dep-cancelled-pre-lock",
          controller.signal,
        ),
      Error,
      "user-cancelled",
    );
  } finally {
    deploymentStoreDeps.getDb = originalGetDb;
  }

  if (dbAccessed) {
    throw new Error(
      "cancellation should short-circuit the lock phase before any DB call",
    );
  }
});

test("executeDeploymentPipeline honors a persisted cancellation flag before state transition", async () => {
  const env = makeEnv();
  const row = makeDeploymentRow({ cancellationRequestedAt: 1_767_225_600_000 });
  const updates: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];

  deploymentStoreDeps.getDb = (() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => Promise.resolve(row),
        }),
      }),
    }),
    update: () => ({
      set: (data: Record<string, unknown>) => {
        updates.push(data);
        return {
          where: () => ({
            run: () => Promise.resolve(),
          }),
        };
      },
    }),
    insert: () => ({
      values: (data: Record<string, unknown>) => {
        events.push(data);
        return {
          run: () => Promise.resolve(),
        };
      },
    }),
  })) as unknown as typeof deploymentStoreDeps.getDb;

  try {
    await assertRejects(
      () =>
        executeDeploymentPipeline(
          env,
          "test-encryption-key",
          "dep-db-cancelled",
        ),
      Error,
      "deployment-cancelled (deployment-pipeline:preflight:dep-db-cancelled)",
    );
  } finally {
    deploymentStoreDeps.getDb = originalGetDb;
  }

  assertEquals(updates.length, 1);
  assertEquals(updates[0].status, "failed");
  assertEquals(updates[0].deployState, "failed");
  assertEquals(updates[0].cancellationRequestedAt, null);
  assertEquals(events.length, 1);
  assertEquals(events[0].eventType, "failed");
});

test("DeploymentService.executeDeployment honors a pre-aborted AbortSignal", async () => {
  const env = makeEnv();
  const service = new DeploymentService(env);
  const controller = new AbortController();
  controller.abort("cancelled-by-test");

  let dbAccessed = false;
  deploymentStoreDeps.getDb = (() => {
    dbAccessed = true;
    throw new Error("db should not be accessed");
  }) as typeof deploymentStoreDeps.getDb;

  try {
    await assertRejects(
      () => service.executeDeployment("dep-x", controller.signal),
      Error,
      "cancelled-by-test",
    );
  } finally {
    deploymentStoreDeps.getDb = originalGetDb;
  }

  if (dbAccessed) {
    throw new Error("cancelled deploy should not touch DB");
  }
});

test("executeDeploymentPipeline default signal (none passed) runs without aborting at phase boundaries", async () => {
  // When no signal is passed the pipeline uses a never-aborted default, so
  // it must NOT throw at the lock-phase boundary. It will of course fail
  // later because the env is empty; we only assert that the failure is not
  // an abort error.
  const env = makeEnv();

  let dbAccessed = false;
  deploymentStoreDeps.getDb = (() => {
    dbAccessed = true;
    throw new Error("controlled-db-error");
  }) as typeof deploymentStoreDeps.getDb;

  try {
    // The pipeline calls getDeploymentById which calls getDb. We expect a
    // controlled-db-error, NOT an abort-related error.
    await assertRejects(
      () =>
        executeDeploymentPipeline(env, "test-encryption-key", "dep-default"),
      Error,
      "controlled-db-error",
    );
  } finally {
    deploymentStoreDeps.getDb = originalGetDb;
  }

  if (!dbAccessed) {
    throw new Error(
      "default (no-signal) deploy should have reached the DB layer",
    );
  }
});
