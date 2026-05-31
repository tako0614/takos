import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { assertEquals, assertNotEquals } from "@std/assert";
import { pathToFileURL } from "node:url";

import { appUsageEvents, appUsageRollups } from "@/db/schema";
import * as schema from "@/db/schema";
import { recordAppUsage } from "@/services/app-usage/usage-recorder";
import { asTestDatabase } from "@test/db-stubs";

async function createUsageTestDb() {
  const dir = await Deno.makeTempDir();
  const dbPath = `${dir}/usage.sqlite`;
  const client = createClient({ url: pathToFileURL(dbPath).href });
  await client.executeMultiple(`
    CREATE TABLE app_usage_events (
      id TEXT PRIMARY KEY NOT NULL,
      idempotency_key TEXT UNIQUE,
      owner_account_id TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'space',
      space_id TEXT,
      meter_type TEXT NOT NULL,
      units REAL NOT NULL,
      reference_id TEXT,
      reference_type TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE app_usage_rollups (
      id TEXT PRIMARY KEY NOT NULL,
      owner_account_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      space_id TEXT,
      meter_type TEXT NOT NULL,
      period_start TEXT NOT NULL,
      units REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_app_usage_rollups_scope
      ON app_usage_rollups (
        owner_account_id,
        scope_type,
        scope_id,
        meter_type,
        period_start
      );
  `);
  return {
    client,
    db: drizzle(client, { schema }),
    dir,
  };
}

Deno.test("recordAppUsage records idempotent app-local usage without billing account rows", async () => {
  const { client, db, dir } = await createUsageTestDb();
  try {
    const usageDb = asTestDatabase(db);
    const first = await recordAppUsage(usageDb, {
      ownerAccountId: "acct_1",
      spaceId: "space_1",
      meterType: "exec_seconds",
      units: 4,
      referenceId: "run_1",
      referenceType: "runtime_exec",
      idempotencyKey: "runtime:run_1",
    });
    const duplicate = await recordAppUsage(usageDb, {
      ownerAccountId: "acct_1",
      spaceId: "space_1",
      meterType: "exec_seconds",
      units: 4,
      referenceId: "run_1",
      referenceType: "runtime_exec",
      idempotencyKey: "runtime:run_1",
    });
    const next = await recordAppUsage(usageDb, {
      ownerAccountId: "acct_1",
      spaceId: "space_1",
      meterType: "exec_seconds",
      units: 6,
      referenceId: "run_2",
      referenceType: "runtime_exec",
      idempotencyKey: "runtime:run_2",
    });

    const events = await db.select().from(appUsageEvents).all();
    const rollups = await db.select().from(appUsageRollups).all();

    assertEquals(first.applied, true);
    assertEquals(duplicate.applied, false);
    assertEquals(duplicate.eventId, "");
    assertEquals(next.applied, true);
    assertNotEquals(first.eventId, next.eventId);
    assertEquals(events.length, 2);
    assertEquals(rollups.length, 1);
    assertEquals(rollups[0].ownerAccountId, "acct_1");
    assertEquals(rollups[0].scopeType, "space");
    assertEquals(rollups[0].scopeId, "space_1");
    assertEquals(rollups[0].units, 10);
  } finally {
    client.close();
    await Deno.remove(dir, { recursive: true });
  }
});
