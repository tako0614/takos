/**
 * Cross-isolate cancellation tests.
 *
 * These tests simulate the production scenario where the cancel HTTP route
 * runs in one isolate while the deploy pipeline runs in another (e.g. a
 * Cloudflare Queue consumer or a different replica). The two isolates share
 * only the database: there is no in-process `AbortController` link.
 *
 * Harness: a single shared in-memory state object stands in for the row in
 * `deployments`. Both `requestDeploymentCancellation` (the "cancel route
 * isolate") and `getDeploymentCancellationRequestedAt` (called by the
 * pipeline's 15 s poller) route through `deploymentStoreDeps.getDb`, so
 * pointing both sides at the same shared state simulates the
 * cross-isolate contract per the spec.
 */
import { assertEquals, assertRejects } from "@std/assert";

import { executeDeploymentPipeline } from "../execute.ts";
import type { DeploymentEnv } from "../models.ts";
import {
  type DeploymentRow,
  deploymentStoreDeps,
  getDeploymentCancellationRequestedAt,
  requestDeploymentCancellation,
} from "../store.ts";

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
    id: "dep-cross-isolate",
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

/**
 * Build a stub `getDb` that backs both the writer side
 * (`requestDeploymentCancellation`) and the reader side
 * (`getDeploymentCancellationRequestedAt`) against the same in-process
 * record. Mutations from either "isolate" become visible immediately to the
 * other side - the same consistency property we expect from a single D1
 * primary read connection.
 */
function bindSharedDb(state: { row: DeploymentRow }): void {
  deploymentStoreDeps.getDb = (() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () =>
            Promise.resolve({
              cancellationRequestedAt: state.row.cancellationRequestedAt,
            }),
        }),
      }),
    }),
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: () => ({
          run: () => {
            if ("cancellationRequestedAt" in data) {
              state.row = {
                ...state.row,
                cancellationRequestedAt: data.cancellationRequestedAt as
                  | number
                  | null,
              };
            }
            return Promise.resolve();
          },
        }),
      }),
    }),
  })) as unknown as typeof deploymentStoreDeps.getDb;
}

Deno.test(
  "cross-isolate cancel: write from one isolate is visible to the other",
  async () => {
    const state = { row: makeDeploymentRow() };
    bindSharedDb(state);

    try {
      const env = makeEnv();
      // Reader sees null initially.
      assertEquals(
        await getDeploymentCancellationRequestedAt(env.DB, state.row.id),
        null,
      );

      // "Cancel route isolate" writes the flag.
      await requestDeploymentCancellation(
        env.DB,
        state.row.id,
        1_767_225_600_000,
      );

      // "Pipeline isolate" observes the flag through the same DB binding.
      assertEquals(
        await getDeploymentCancellationRequestedAt(env.DB, state.row.id),
        1_767_225_600_000,
      );
    } finally {
      deploymentStoreDeps.getDb = originalGetDb;
    }
  },
);

Deno.test(
  "cross-isolate cancel: pipeline observes a DB-set flag at preflight (acts as fast path before poller arms)",
  async () => {
    const state = {
      row: makeDeploymentRow({ cancellationRequestedAt: 1_767_225_600_000 }),
    };

    // Both the pipeline-side `getDeploymentById` and the
    // `requestDeploymentCancellation` writer route through the same shared
    // state - this is the "two service instances pointing at same DB
    // connection" harness from the spec.
    deploymentStoreDeps.getDb = (() => ({
      select: () => ({
        from: () => ({
          where: () => ({
            get: () => Promise.resolve(state.row),
          }),
        }),
      }),
      update: () => ({
        set: (data: Record<string, unknown>) => ({
          where: () => ({
            run: () => {
              if ("cancellationRequestedAt" in data) {
                state.row = {
                  ...state.row,
                  cancellationRequestedAt: data.cancellationRequestedAt as
                    | number
                    | null,
                };
              }
              return Promise.resolve();
            },
          }),
        }),
      }),
      insert: () => ({
        values: () => ({ run: () => Promise.resolve() }),
      }),
    })) as unknown as typeof deploymentStoreDeps.getDb;

    try {
      const env = makeEnv();
      // The pipeline starts in the "other isolate" with no in-process
      // signal. The DB-set flag should still take effect.
      const t0 = Date.now();
      await assertRejects(
        () =>
          executeDeploymentPipeline(env, "test-encryption-key", state.row.id),
        Error,
        "deployment-cancelled (deployment-pipeline:preflight",
      );
      const elapsedMs = Date.now() - t0;

      // The preflight fast-path resolves immediately, well under the
      // 30 s cross-isolate budget.
      if (elapsedMs > 30_000) {
        throw new Error(
          `cross-isolate cancel must resolve within 30 s, got ${elapsedMs} ms`,
        );
      }

      // Cleanup hook clears the flag back to NULL so re-runs cannot loop.
      assertEquals(state.row.cancellationRequestedAt, null);
    } finally {
      deploymentStoreDeps.getDb = originalGetDb;
    }
  },
);
