import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import { updateServiceDeploymentPointers } from "../store.ts";

/**
 * Guards the concurrent same-service deploy serialization: an older deploy whose
 * pipeline commits after a newer one must NOT regress the authoritative active
 * pointer / current_version (lost update / order inversion). The forward
 * promotion path sets guardMonotonicVersion; rollback (which intentionally
 * promotes an OLDER version) leaves it unset and must still apply.
 */

async function seedService(currentVersion: number, activeDeploymentId: string) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE services (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      group_id TEXT,
      service_type TEXT NOT NULL DEFAULT 'app',
      name_type TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      config TEXT,
      hostname TEXT,
      route_ref TEXT,
      slug TEXT,
      active_deployment_id TEXT,
      fallback_deployment_id TEXT,
      current_version INTEGER NOT NULL DEFAULT 0,
      workload_kind TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  await client.execute({
    sql:
      `INSERT INTO services (id, account_id, status, active_deployment_id, current_version, created_at, updated_at)
       VALUES ('svc_1', 'space_1', 'deployed', ?, ?, '2026-01-01', '2026-01-01')`,
    args: [activeDeploymentId, currentVersion],
  });
  const db = drizzle(client, { schema }) as unknown as SqlDatabaseBinding;
  return { client, db };
}

async function readPointer(client: Awaited<ReturnType<typeof seedService>>["client"]) {
  const row = await client.execute(
    "SELECT active_deployment_id, current_version FROM services WHERE id = 'svc_1'",
  );
  return {
    activeDeploymentId: row.rows[0].active_deployment_id as string,
    currentVersion: Number(row.rows[0].current_version),
  };
}

test("guarded promotion rejects an older version and leaves the pointer intact", async () => {
  const { client, db } = await seedService(5, "dep_5");
  const applied = await updateServiceDeploymentPointers(db, "svc_1", {
    activeDeploymentId: "dep_3",
    fallbackDeploymentId: null,
    activeDeploymentVersion: 3,
    updatedAt: "2026-02-01",
    guardMonotonicVersion: true,
  });
  assertEquals(applied, false);
  assertEquals(await readPointer(client), {
    activeDeploymentId: "dep_5",
    currentVersion: 5,
  });
});

test("guarded promotion applies a newer version", async () => {
  const { client, db } = await seedService(5, "dep_5");
  const applied = await updateServiceDeploymentPointers(db, "svc_1", {
    activeDeploymentId: "dep_6",
    fallbackDeploymentId: "dep_5",
    activeDeploymentVersion: 6,
    updatedAt: "2026-02-01",
    guardMonotonicVersion: true,
  });
  assertEquals(applied, true);
  assertEquals(await readPointer(client), {
    activeDeploymentId: "dep_6",
    currentVersion: 6,
  });
});

test("guarded promotion is idempotent for the same version (resume)", async () => {
  const { client, db } = await seedService(6, "dep_6");
  const applied = await updateServiceDeploymentPointers(db, "svc_1", {
    activeDeploymentId: "dep_6",
    fallbackDeploymentId: null,
    activeDeploymentVersion: 6,
    updatedAt: "2026-02-01",
    guardMonotonicVersion: true,
  });
  assertEquals(applied, true);
  assertEquals((await readPointer(client)).currentVersion, 6);
});

test("unguarded promotion still rolls back to an OLDER version", async () => {
  const { client, db } = await seedService(6, "dep_6");
  const applied = await updateServiceDeploymentPointers(db, "svc_1", {
    activeDeploymentId: "dep_4",
    fallbackDeploymentId: null,
    activeDeploymentVersion: 4,
    updatedAt: "2026-02-01",
    // No guardMonotonicVersion -> rollback to an older version must apply.
  });
  assertEquals(applied, true);
  assertEquals(await readPointer(client), {
    activeDeploymentId: "dep_4",
    currentVersion: 4,
  });
});
