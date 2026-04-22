import { assertEquals } from "jsr:@std/assert";

import type { Env } from "../shared/types/index.ts";
import { runScheduledFamilyMaintenance } from "../web.ts";

type ScheduledFamilyMaintenanceDeps = NonNullable<
  Parameters<typeof runScheduledFamilyMaintenance>[4]
>;

function createTestEnv(): Env {
  return {
    DB: { name: "db" },
    GIT_OBJECTS: { name: "git-objects" },
  } as unknown as Env;
}

function createDeps(
  env: Env,
  calls: string[],
  overrides: Partial<ScheduledFamilyMaintenanceDeps> = {},
): ScheduledFamilyMaintenanceDeps {
  return {
    cleanupDeadSessions: async () => {
      calls.push("cleanup");
      return {
        markedDead: 1,
        cutoffTime: "2026-01-01T00:00:00.000Z",
        startupCutoff: "2026-01-01T00:00:00.000Z",
        heartbeatTimeoutMs: 120000,
        startupGraceMs: 30000,
      };
    },
    reconcileStuckDomains: async () => {
      calls.push("reconcile");
      return { scanned: 0, cleaned: 0, reset: 0, errors: 0 };
    },
    runCustomDomainReverification: async () => {
      calls.push("reverify");
      return {
        scanned: 0,
        active: 0,
        verifying: 0,
        failed: 0,
        expired: 0,
        sslPromoted: 0,
        errors: 0,
      };
    },
    runR2OrphanedObjectGcBatch: async () => {
      calls.push("orphan");
      return {
        skipped: false,
        dry_run: false,
        started_at: "2026-01-01T00:00:00Z",
        min_age_minutes: 1440,
        scanned: { blobs: 0, trees: 0 },
        candidates: { blobs: 0, trees: 0 },
        deleted: { blobs: 0, trees: 0 },
        next_cursors: {},
      };
    },
    runSnapshotGcBatch: async () => {
      calls.push("snapshot");
      return {
        candidates: { sessions: 0, blobs: 0, oldSnapshots: 0 },
        processed: 0,
        deletedBlobs: 0,
        deletedSnapshots: 0,
        deletedSessionFiles: 0,
        errors: 0,
        spaces: [],
      };
    },
    runWorkflowArtifactGcBatch: async (db, bucket, options) => {
      calls.push("artifact");
      assertEquals(db, env.DB);
      assertEquals(bucket, env.GIT_OBJECTS);
      assertEquals(options, { maxDeletes: 100 });
      return {
        scanned: 0,
        deletedRows: 0,
        deletedR2Objects: 0,
        errors: 0,
      };
    },
    processDefaultAppPreinstallJobs: async () => {
      calls.push("default-app");
      return {
        scanned: 0,
        processed: 0,
        completed: 0,
        deploymentQueued: 0,
        blocked: 0,
        paused: 0,
        requeued: 0,
        failed: 0,
      };
    },
    logInfo: () => {},
    ...overrides,
  };
}

Deno.test("runScheduledFamilyMaintenance includes workflow artifact GC in the hourly family", async () => {
  const env = createTestEnv();
  const calls: string[] = [];
  const errors: Array<{ job: string; error: string }> = [];

  await runScheduledFamilyMaintenance(
    env,
    "0 * * * *",
    errors,
    {},
    createDeps(env, calls),
  );

  assertEquals(calls, ["cleanup", "snapshot", "orphan", "artifact"]);
  assertEquals(errors, []);
});

Deno.test("runScheduledFamilyMaintenance keeps hourly jobs running after workflow artifact GC failures", async () => {
  const env = createTestEnv();
  const calls: string[] = [];
  const errors: Array<{ job: string; error: string }> = [];

  await runScheduledFamilyMaintenance(
    env,
    "0 * * * *",
    errors,
    {},
    createDeps(env, calls, {
      runWorkflowArtifactGcBatch: async () => {
        calls.push("artifact");
        throw new Error("artifact gc failed");
      },
    }),
  );

  assertEquals(calls, ["cleanup", "snapshot", "orphan", "artifact"]);
  assertEquals(errors, [{
    job: "workflow-artifact-gc",
    error: "artifact gc failed",
  }]);
});
