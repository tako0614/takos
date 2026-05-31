import { test } from "bun:test";
import { assertEquals } from "@std/assert";

import type { ObjectStoreBinding } from "../../../../shared/types/bindings.ts";
import { UnsupportedOperationError } from "../../../../shared/utils/unsupported-operation.ts";
import { runD1DailyBackup } from "../backup-maintenance.ts";

function createBucketStub(): ObjectStoreBinding {
  return {
    get: async () => null,
    put: async () => {
      throw new Error("unexpected put");
    },
  } as unknown as ObjectStoreBinding;
}

test("runD1DailyBackup skips unsupported DB.dump capability errors", async () => {
  const env = {
    DB: {
      dump: async () => {
        throw new UnsupportedOperationError(
          "dump",
          "DB.dump() is not implemented for the local Postgres adapter",
        );
      },
    },
    TAKOS_OFFLOAD: createBucketStub(),
  } as unknown as Parameters<typeof runD1DailyBackup>[0];

  const result = await runD1DailyBackup(env);

  assertEquals(result, {
    skipped: true,
    reason:
      "DB.dump() is not supported by this local database adapter; configure provider SQL export credentials instead.",
  });
});

test("runD1DailyBackup detects unsupported DB.dump by adapter message", async () => {
  const env = {
    DB: {
      dump: async () => {
        throw new Error(
          "DB.dump() is not implemented for the local Postgres adapter",
        );
      },
    },
    TAKOS_OFFLOAD: createBucketStub(),
  } as unknown as Parameters<typeof runD1DailyBackup>[0];

  const result = await runD1DailyBackup(env);

  assertEquals(result, {
    skipped: true,
    reason:
      "DB.dump() is not supported by this local database adapter; configure provider SQL export credentials instead.",
  });
});
