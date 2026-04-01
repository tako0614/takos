import { assertEquals } from "jsr:@std/assert";

import { runD1DailyBackup } from "../../../../packages/control/src/application/services/maintenance/backup-maintenance.ts";

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

Deno.test("runD1DailyBackup skips when TAKOS_OFFLOAD is not configured", async () => {
  const result = await runD1DailyBackup({
    DB: {} as never,
  });

  assertEquals(result, {
    skipped: true,
    reason: "TAKOS_OFFLOAD bucket not configured",
  });
});

Deno.test("runD1DailyBackup skips when the current UTC day is already backed up", async () => {
  const now = new Date();
  const result = await runD1DailyBackup({
    DB: {} as never,
    TAKOS_OFFLOAD: createBucketWithState(now.toISOString()) as never,
  });

  assertEquals(result, {
    skipped: true,
    reason: "already backed up today (UTC)",
  });
});
