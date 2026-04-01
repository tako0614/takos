import { assertEquals } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, stub } from "jsr:@std/testing/mock";

import type { Env } from "../../../../types.ts";
import { runCommonEnvScheduledMaintenance } from "../maintenance.ts";
import { CommonEnvOrchestrator } from "../orchestrator.ts";

function createTestEnv(): Env {
  return {
    DB: {} as Env["DB"],
  } as Env;
}

Deno.test("runCommonEnvScheduledMaintenance - processes reconcile jobs on 15-minute cron", async () => {
  const processReconcileJobs = stub(
    CommonEnvOrchestrator.prototype,
    "processReconcileJobs",
    async () => ({ processed: 5, completed: 3, retried: 2 }),
  );
  const errors: Array<{ job: string; error: string }> = [];

  try {
    await runCommonEnvScheduledMaintenance({
      env: createTestEnv(),
      cron: "*/15 * * * *",
      errors,
    });

    assertSpyCallArgs(processReconcileJobs, 0, [150]);
    assertEquals(errors, []);
  } finally {
    processReconcileJobs.restore();
  }
});

Deno.test("runCommonEnvScheduledMaintenance - enqueues periodic drift sweep on hourly cron", async () => {
  const enqueuePeriodicDriftSweep = stub(
    CommonEnvOrchestrator.prototype,
    "enqueuePeriodicDriftSweep",
    async () => 10,
  );
  const errors: Array<{ job: string; error: string }> = [];

  try {
    await runCommonEnvScheduledMaintenance({
      env: createTestEnv(),
      cron: "0 * * * *",
      errors,
    });

    assertSpyCallArgs(enqueuePeriodicDriftSweep, 0, [200]);
    assertEquals(errors, []);
  } finally {
    enqueuePeriodicDriftSweep.restore();
  }
});

Deno.test("runCommonEnvScheduledMaintenance - captures reconcile job errors", async () => {
  const processReconcileJobs = stub(
    CommonEnvOrchestrator.prototype,
    "processReconcileJobs",
    async () => {
      throw new Error("DB error");
    },
  );
  const errors: Array<{ job: string; error: string }> = [];

  try {
    await runCommonEnvScheduledMaintenance({
      env: createTestEnv(),
      cron: "*/15 * * * *",
      errors,
    });

    assertSpyCalls(processReconcileJobs, 1);
    assertEquals(errors, [{ job: "common-env.reconcile", error: "DB error" }]);
  } finally {
    processReconcileJobs.restore();
  }
});

Deno.test("runCommonEnvScheduledMaintenance - captures drift sweep errors", async () => {
  const enqueuePeriodicDriftSweep = stub(
    CommonEnvOrchestrator.prototype,
    "enqueuePeriodicDriftSweep",
    async () => {
      throw new Error("sweep failed");
    },
  );
  const errors: Array<{ job: string; error: string }> = [];

  try {
    await runCommonEnvScheduledMaintenance({
      env: createTestEnv(),
      cron: "0 * * * *",
      errors,
    });

    assertSpyCalls(enqueuePeriodicDriftSweep, 1);
    assertEquals(errors, [{
      job: "common-env.drift-enqueue",
      error: "sweep failed",
    }]);
  } finally {
    enqueuePeriodicDriftSweep.restore();
  }
});

Deno.test("runCommonEnvScheduledMaintenance - does nothing for unrelated cron expressions", async () => {
  const processReconcileJobs = stub(
    CommonEnvOrchestrator.prototype,
    "processReconcileJobs",
    async () => ({ processed: 0, completed: 0, retried: 0 }),
  );
  const enqueuePeriodicDriftSweep = stub(
    CommonEnvOrchestrator.prototype,
    "enqueuePeriodicDriftSweep",
    async () => 0,
  );
  const errors: Array<{ job: string; error: string }> = [];

  try {
    await runCommonEnvScheduledMaintenance({
      env: createTestEnv(),
      cron: "0 0 * * *",
      errors,
    });

    assertSpyCalls(processReconcileJobs, 0);
    assertSpyCalls(enqueuePeriodicDriftSweep, 0);
    assertEquals(errors, []);
  } finally {
    enqueuePeriodicDriftSweep.restore();
    processReconcileJobs.restore();
  }
});

Deno.test("runCommonEnvScheduledMaintenance - handles non-Error objects in error capture", async () => {
  const processReconcileJobs = stub(
    CommonEnvOrchestrator.prototype,
    "processReconcileJobs",
    async () => {
      throw "string error";
    },
  );
  const errors: Array<{ job: string; error: string }> = [];

  try {
    await runCommonEnvScheduledMaintenance({
      env: createTestEnv(),
      cron: "*/15 * * * *",
      errors,
    });

    assertSpyCalls(processReconcileJobs, 1);
    assertEquals(errors, [{
      job: "common-env.reconcile",
      error: "string error",
    }]);
  } finally {
    processReconcileJobs.restore();
  }
});
