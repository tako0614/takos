import { test } from "bun:test";
import { assertEquals, assertRejects } from "@takos/test/assert";
import { ConflictError } from "@takos/worker-platform-utils/errors";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import { createDeploymentWithVersion, deploymentStoreDeps } from "../store.ts";

/**
 * Guards the per-service idempotency-key behavior (migration 0080): the
 * insert-time UNIQUE collision discriminator must (a) RETRY a (service_id,
 * version) race and (b) surface a (service_id, idempotency_key) collision as a
 * distinct ConflictError instead of exhausting retries with a misleading
 * "failed to allocate version" error. A regression that stopped distinguishing
 * the two messages would either spin retries on a key collision or 500 a
 * legitimate idempotent race.
 */

type InsertBehavior = (attempt: number) => Record<string, unknown>;

function stubDb(maxVersion: number, insert: InsertBehavior): SqlDatabaseBinding {
  let attempt = 0;
  const drizzle = {
    select() {
      return {
        from() {
          return {
            where() {
              return { get: async () => ({ maxVersion }) };
            },
          };
        },
      };
    },
    insert() {
      return {
        values() {
          return {
            returning() {
              return { get: async () => insert(attempt++) };
            },
          };
        },
      };
    },
  };
  return drizzle as unknown as SqlDatabaseBinding;
}

async function withStub<T>(
  db: SqlDatabaseBinding,
  fn: () => Promise<T>,
): Promise<T> {
  const original = deploymentStoreDeps.getDb;
  deploymentStoreDeps.getDb = () => db as never;
  try {
    return await fn();
  } finally {
    deploymentStoreDeps.getDb = original;
  }
}

const VERSION_COLLISION =
  "UNIQUE constraint failed: deployments.service_id, deployments.version";
const KEY_COLLISION =
  "UNIQUE constraint failed: deployments.service_id, deployments.idempotency_key";

const buildData = ((version: number) => ({ version })) as never;

test("createDeploymentWithVersion retries a (service_id, version) race, then succeeds", async () => {
  let inserts = 0;
  const db = stubDb(4, (attempt) => {
    inserts++;
    if (attempt === 0) throw new Error(VERSION_COLLISION);
    return { id: "dep_1", serviceId: "svc_a", version: 5 };
  });

  const result = await withStub(
    db,
    () => createDeploymentWithVersion(db, "svc_a", buildData),
  );

  assertEquals(result.version, 5);
  assertEquals(result.deployment.version, 5);
  assertEquals(inserts, 2); // first attempt collided, retry succeeded
});

test("createDeploymentWithVersion surfaces an idempotency-key collision as ConflictError (no retry spin)", async () => {
  let inserts = 0;
  const db = stubDb(4, () => {
    inserts++;
    throw new Error(KEY_COLLISION);
  });

  await assertRejects(
    () => withStub(db, () => createDeploymentWithVersion(db, "svc_a", buildData)),
    ConflictError,
    "idempotency key conflict",
  );
  assertEquals(inserts, 1); // key collision is terminal — not retried
});

test("createDeploymentWithVersion re-throws the raw version-collision error after exhausting retries (never a ConflictError)", async () => {
  const db = stubDb(4, () => {
    throw new Error(VERSION_COLLISION);
  });

  // After MAX_VERSION_RETRIES the last attempt falls through to re-throw the
  // underlying UNIQUE error — it must stay a plain version error, NOT be
  // misclassified as a key ConflictError.
  const err = await withStub(db, async () => {
    try {
      await createDeploymentWithVersion(db, "svc_a", buildData);
      return null;
    } catch (e) {
      return e;
    }
  });
  assertEquals(err instanceof ConflictError, false);
  assertEquals(
    err instanceof Error &&
      err.message.includes("deployments.service_id, deployments.version"),
    true,
  );
});
