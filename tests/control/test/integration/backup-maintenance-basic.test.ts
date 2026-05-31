import { assertEquals } from "@std/assert";

import { createMockEnv, MockObjectStoreBinding } from "./setup.ts";
import {
  runD1BackupIntegrityCheck,
  runD1BackupInventory,
  runD1DailyBackup,
} from "@/application/services/maintenance/backup-maintenance.ts";

// The backup-maintenance helpers accept a private `BackupEnv` shape; we
// recover that shape via the function signatures so test inputs satisfy the
// contract without `as any`.
type BackupEnv = Parameters<typeof runD1DailyBackup>[0];

Deno.test("backup maintenance skips cleanly when TAKOS_OFFLOAD is not configured", async () => {
  const env = createMockEnv() satisfies BackupEnv;

  const backup = await runD1DailyBackup(env);
  assertEquals(backup, {
    skipped: true,
    reason: "TAKOS_OFFLOAD bucket not configured",
  });

  const inventory = await runD1BackupInventory(env);
  assertEquals(inventory, {
    skipped: true,
    reason: "TAKOS_OFFLOAD bucket not configured",
  });

  const integrity = await runD1BackupIntegrityCheck(env);
  assertEquals(integrity, {
    skipped: true,
    reason: "TAKOS_OFFLOAD bucket not configured",
  });
});

Deno.test("daily backup skips cleanly when DB.dump is unsupported locally", async () => {
  const baseEnv = createMockEnv({
    TAKOS_OFFLOAD: new MockObjectStoreBinding(),
    CF_ACCOUNT_ID: undefined,
    CF_API_TOKEN: undefined,
  });
  // Override DB.dump on the typed env to surface the unsupported-adapter path.
  const env: BackupEnv = {
    ...baseEnv,
    DB: {
      ...baseEnv.DB,
      dump: async () => {
        throw new Error(
          "DB.dump() is not implemented for the local Postgres adapter",
        );
      },
    },
  };

  const result = await runD1DailyBackup(env, {
    retentionDays: 35,
    force: true,
  });

  assertEquals(result, {
    skipped: true,
    reason:
      "DB.dump() is not supported by this local database adapter; configure provider SQL export credentials instead.",
  });
});
