import { assertEquals } from "jsr:@std/assert";

import { createMockEnv, MockR2Bucket } from "./setup.ts";
import {
  runD1BackupIntegrityCheck,
  runD1BackupInventory,
  runD1DailyBackup,
} from "@/application/services/maintenance/backup-maintenance.ts";

Deno.test("backup maintenance skips cleanly when TAKOS_OFFLOAD is not configured", async () => {
  const env = createMockEnv();

  const backup = await runD1DailyBackup(env as any);
  assertEquals(backup, {
    skipped: true,
    reason: "TAKOS_OFFLOAD bucket not configured",
  });

  const inventory = await runD1BackupInventory(env as any);
  assertEquals(inventory, {
    skipped: true,
    reason: "TAKOS_OFFLOAD bucket not configured",
  });

  const integrity = await runD1BackupIntegrityCheck(env as any);
  assertEquals(integrity, {
    skipped: true,
    reason: "TAKOS_OFFLOAD bucket not configured",
  });
});

Deno.test("daily backup skips cleanly when DB.dump is unsupported locally", async () => {
  const env = createMockEnv({
    TAKOS_OFFLOAD: new MockR2Bucket(),
    CF_ACCOUNT_ID: undefined,
    CF_API_TOKEN: undefined,
    DB: {
      dump: async () => {
        throw new Error(
          "DB.dump() is not implemented for the local Postgres adapter",
        );
      },
    },
  });

  const result = await runD1DailyBackup(env as any, {
    retentionDays: 35,
    force: true,
  });

  assertEquals(result, {
    skipped: true,
    reason:
      "DB.dump() is not supported by this local database adapter; configure Cloudflare D1 export credentials instead.",
  });
});
