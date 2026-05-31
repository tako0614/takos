import { strict as assert } from "node:assert";
import { test } from "bun:test";

import { runD1DailyBackup } from "../../../../src/worker/application/services/maintenance/backup-maintenance.ts";

function createBucketWithState(lastSuccessAt?: string) {
  return {
    async get(_key: string) {
      if (!lastSuccessAt) return null;
      return {
        async json() {
          return { last_success_at: lastSuccessAt };
        },
      };
    },
  };
}

test("daily SQL backup skips when TAKOS_OFFLOAD is not configured", async () => {
  const result = await runD1DailyBackup({
    DB: {} as never,
  });

  assert.deepStrictEqual(result, {
    skipped: true,
    reason: "TAKOS_OFFLOAD bucket not configured",
  });
});

test("daily SQL backup skips when the current UTC day is already backed up", async () => {
  const now = new Date();
  const result = await runD1DailyBackup({
    DB: {} as never,
    TAKOS_OFFLOAD: createBucketWithState(now.toISOString()) as never,
  });

  assert.deepStrictEqual(result, {
    skipped: true,
    reason: "already backed up today (UTC)",
  });
});
