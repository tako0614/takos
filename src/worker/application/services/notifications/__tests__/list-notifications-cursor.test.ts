import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import { listNotifications } from "../service.ts";

/**
 * Guards the keyset-pagination tiebreaker: two notifications sharing a
 * millisecond at a page boundary must not be skipped. The legacy timestamp-only
 * cursor drops the unreturned tied row; the composite (created_at, id) cursor
 * must return it.
 */

const T200 = "2026-01-01T00:00:00.200Z";
const T100 = "2026-01-01T00:00:00.100Z";
const T300 = "2026-01-01T00:00:00.300Z";

async function makeDb() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE notification_preferences (
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      channel TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '2026-01-01',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01',
      PRIMARY KEY (account_id, type, channel)
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      recipient_account_id TEXT NOT NULL,
      account_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      data TEXT NOT NULL DEFAULT '{}',
      read_at TEXT,
      created_at TEXT NOT NULL,
      email_status TEXT NOT NULL DEFAULT 'skipped',
      email_attempts INTEGER NOT NULL DEFAULT 0,
      email_sent_at TEXT,
      email_error TEXT
    );
  `);
  // Order by (created_at desc, id desc): [A(300), C(200,"c"), B(200,"b"), D(100)]
  const rows: Array<[string, string]> = [
    ["a", T300],
    ["b", T200],
    ["c", T200],
    ["d", T100],
  ];
  for (const [id, createdAt] of rows) {
    await client.execute({
      sql:
        `INSERT INTO notifications (id, recipient_account_id, type, title, created_at)
         VALUES (?, 'user_1', 'run.completed', 't', ?)`,
      args: [id, createdAt],
    });
  }
  const db = drizzle(client, { schema }) as unknown as SqlDatabaseBinding;
  return db;
}

test("composite cursor does not skip a same-millisecond row at the page boundary", async () => {
  const db = await makeDb();
  const page1 = await listNotifications(db, "user_1", { limit: 2 });
  assertEquals(page1.notifications.map((n) => n.id), ["a", "c"]);

  // Page 2 with the composite cursor (last row = c @ T200).
  const page2 = await listNotifications(db, "user_1", {
    limit: 2,
    before: T200,
    beforeId: "c",
  });
  // B (same ms as the boundary, id "b" < "c") must NOT be skipped.
  assertEquals(page2.notifications.map((n) => n.id), ["b", "d"]);
});

test("legacy timestamp-only cursor still works (and exhibits the skip it is meant to replace)", async () => {
  const db = await makeDb();
  // No beforeId -> legacy lt(createdAt, before): the same-ms row "b" is dropped.
  const page2 = await listNotifications(db, "user_1", {
    limit: 2,
    before: T200,
  });
  assertEquals(page2.notifications.map((n) => n.id), ["d"]);
});
