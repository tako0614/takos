import { strict as assert } from "node:assert";
import { test } from "bun:test";

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

test("backup maintenance skips cleanly when TAKOS_OFFLOAD is not configured", async () => {
  const env = createMockEnv() satisfies BackupEnv;

  const backup = await runD1DailyBackup(env);
  assert.deepStrictEqual(backup, {
    skipped: true,
    reason: "TAKOS_OFFLOAD bucket not configured",
  });

  const inventory = await runD1BackupInventory(env);
  assert.deepStrictEqual(inventory, {
    skipped: true,
    reason: "TAKOS_OFFLOAD bucket not configured",
  });

  const integrity = await runD1BackupIntegrityCheck(env);
  assert.deepStrictEqual(integrity, {
    skipped: true,
    reason: "TAKOS_OFFLOAD bucket not configured",
  });
});

test("daily backup skips cleanly when DB.dump is unsupported locally", async () => {
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

  assert.deepStrictEqual(result, {
    skipped: true,
    reason:
      "DB.dump() is not supported by this local database adapter; configure provider SQL export credentials instead.",
  });
});
