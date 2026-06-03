import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import { cleanupDeadSessions } from "../session-maintenance.ts";

/**
 * Behavioral guard for git-mode session liveness. `sessions.lastHeartbeat` has no
 * writer, so reaping must NOT fire on null heartbeat at the 30s grace (that would
 * kill every active session). Instead a running session is reaped only when
 * either (a) a recorded heartbeat went stale, or (b) it is older than the
 * absolute lifetime cap (abandoned). Active sessions are never reaped.
 */

const NOW = Date.parse("2026-06-03T12:00:00.000Z");
const clock = { now: () => NOW };
const H = 60 * 60 * 1000;
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();

async function seedSessions() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      base_snapshot_id TEXT NOT NULL,
      status TEXT NOT NULL,
      last_heartbeat TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const rows: Array<[string, string, string, string | null, string]> = [
    // id, status, createdAtIso, lastHeartbeatIso, expectedAfter
    ["run-old", "running", iso(25 * H), null, "dead"], // abandoned (age > 24h)
    ["run-recent", "running", iso(1 * H), null, "running"], // active, no stale hb
    ["run-startup", "running", iso(10_000), null, "running"], // within startup grace
    ["run-stale-hb", "running", iso(1 * H), iso(5 * 60_000), "dead"], // hb went stale
    ["run-fresh-hb", "running", iso(1 * H), iso(30_000), "running"], // hb fresh
    ["stopped-old", "stopped", iso(25 * H), null, "stopped"], // not running
  ];
  for (const [id, status, createdAt, lastHeartbeat] of rows) {
    await client.execute({
      sql:
        `INSERT INTO sessions (id, account_id, base_snapshot_id, status, last_heartbeat, created_at, updated_at)
         VALUES (?, 'space_1', 'git-mode', ?, ?, ?, ?)`,
      args: [id, status, lastHeartbeat, createdAt, createdAt],
    });
  }
  const db = drizzle(client, { schema });
  return { client, db, expected: new Map(rows.map((r) => [r[0], r[4]])) };
}

test("cleanupDeadSessions reaps abandoned (age) and stale-heartbeat sessions, never active ones", async () => {
  const { client, db, expected } = await seedSessions();

  const summary = await cleanupDeadSessions(
    { DB: db as unknown as SqlDatabaseBinding },
    undefined,
    clock,
  );

  assertEquals(summary.markedDead, 2);
  const result = await client.execute("SELECT id, status FROM sessions");
  for (const row of result.rows) {
    assertEquals(
      row.status,
      expected.get(row.id as string),
      `${row.id} status`,
    );
  }
});

test("cleanupDeadSessions respects a larger maxSessionAgeMs (null heartbeat alone never reaps)", async () => {
  const { client, db } = await seedSessions();

  // With a 48h cap, the 25h-old null-heartbeat session is NOT abandoned yet, so
  // only the stale-heartbeat session is reaped — proving null heartbeat is never
  // itself a death signal.
  const summary = await cleanupDeadSessions(
    { DB: db as unknown as SqlDatabaseBinding },
    { maxSessionAgeMs: 48 * H },
    clock,
  );

  assertEquals(summary.markedDead, 1);
  const old = await client.execute(
    "SELECT status FROM sessions WHERE id = 'run-old'",
  );
  assertEquals(old.rows[0].status, "running");
});
