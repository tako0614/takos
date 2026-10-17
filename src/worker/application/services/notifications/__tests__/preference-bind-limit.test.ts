import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import type {
  EdgeSqlBinding,
  EdgeSqlResult,
  EdgeSqlStatement,
  EdgeSqlValue,
} from "../../../../shared/types/bindings.ts";
import { adaptEdgeSqlBinding } from "../../../../platform/adapters/edge-sql.ts";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationType,
} from "../notification-models.ts";
import {
  ensureNotificationPreferences,
  updateNotificationPreferences,
} from "../service.ts";

type CapturedStatement = { sql: string; parameterCount: number };

async function makeBoundedDb() {
  const client = createClient({ url: ":memory:" });
  await client.execute(`
    CREATE TABLE notification_preferences (
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      channel TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, type, channel)
    )
  `);
  const statements: CapturedStatement[] = [];
  const execute = async (
    sql: string,
    params: readonly EdgeSqlValue[] = [],
  ): Promise<EdgeSqlResult> => {
    statements.push({ sql, parameterCount: params.length });
    const result = await client.execute({ sql, args: params as never });
    return {
      rows: result.rows.map((row) =>
        Object.fromEntries(Object.entries(row)) as Record<string, EdgeSqlValue>
      ),
      rowsWritten: result.rowsAffected,
    };
  };
  const binding: EdgeSqlBinding = {
    execute,
    async query(sql, params) {
      const result = await execute(sql, params);
      return { rows: result.rows, rowsWritten: 0 };
    },
    async transaction(items: readonly EdgeSqlStatement[]) {
      for (const item of items) {
        statements.push({
          sql: item.sql,
          parameterCount: item.params?.length ?? 0,
        });
      }
      const results = await client.batch(
        items.map((item) => ({
          sql: item.sql,
          args: (item.params ?? []) as never,
        })),
        "write",
      );
      return {
        results: results.map((result) => ({
          rows: result.rows.map((row) =>
            Object.fromEntries(Object.entries(row)) as Record<string, EdgeSqlValue>
          ),
          rowsWritten: result.rowsAffected,
        })),
      };
    },
  };
  return { db: adaptEdgeSqlBinding(binding), client, statements };
}

function preferenceInserts(statements: CapturedStatement[]) {
  return statements.filter((statement) =>
    /^insert into "notification_preferences"/iu.test(statement.sql.trim())
  );
}

function preferenceUpdates(statements: CapturedStatement[]) {
  return statements.filter((statement) =>
    /^update "notification_preferences"/iu.test(statement.sql.trim())
  );
}

function assertBoundedPreferenceInserts(statements: CapturedStatement[]) {
  const inserts = preferenceInserts(statements);
  expect(inserts.length).toBeGreaterThan(1);
  for (const insert of inserts) {
    expect(insert.parameterCount).toBeLessThanOrEqual(90);
  }
}

async function preferenceRows(client: Client, accountId: string) {
  const result = await client.execute({
    sql: `SELECT type, channel, enabled FROM notification_preferences
      WHERE account_id = ? ORDER BY type, channel`,
    args: [accountId],
  });
  return result.rows.map((row) => ({
    type: String(row.type),
    channel: String(row.channel),
    enabled: Number(row.enabled) === 1,
  }));
}

test("ensureNotificationPreferences creates every default under the D1 bind cap", async () => {
  const { db, client, statements } = await makeBoundedDb();

  await ensureNotificationPreferences(db, "owner-empty");

  const rows = await preferenceRows(client, "owner-empty");
  expect(rows).toHaveLength(NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length);
  for (const row of rows) {
    const type = row.type as NotificationType;
    const channel = row.channel as NotificationChannel;
    expect(row.enabled).toBe(DEFAULT_NOTIFICATION_PREFERENCES[type][channel]);
  }
  assertBoundedPreferenceInserts(statements);
});

test("updateNotificationPreferences chunks all missing choices and normalizes unsupported push", async () => {
  const { db, client, statements } = await makeBoundedDb();
  const updates = NOTIFICATION_TYPES.flatMap((type) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      type,
      channel,
      enabled: true,
    }))
  );

  const result = await updateNotificationPreferences(db, "owner-updated", updates);

  const rows = await preferenceRows(client, "owner-updated");
  expect(rows).toHaveLength(NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length);
  for (const type of NOTIFICATION_TYPES) {
    expect(result[type].in_app).toBe(true);
    expect(result[type].email).toBe(true);
    expect(result[type].push).toBe(
      type === "run.completed" || type === "run.failed",
    );
  }
  assertBoundedPreferenceInserts(statements);
});

test("default filling preserves an existing opt-out and isolates account rows", async () => {
  const { db, client, statements } = await makeBoundedDb();
  await client.execute({
    sql: `INSERT INTO notification_preferences
      (account_id, type, channel, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["owner-kept", "run.completed", "push", 0, "ts", "ts"],
  });

  await ensureNotificationPreferences(db, "owner-kept");
  await ensureNotificationPreferences(db, "owner-new");

  const kept = await preferenceRows(client, "owner-kept");
  expect(kept).toHaveLength(NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length);
  expect(
    kept.find((row) => row.type === "run.completed" && row.channel === "push")
      ?.enabled,
  ).toBe(false);
  expect(await preferenceRows(client, "owner-new")).toHaveLength(
    NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length,
  );
  assertBoundedPreferenceInserts(statements);
});

test("unsupported persisted push types are disabled in bounded atomic updates", async () => {
  const { db, client, statements } = await makeBoundedDb();
  const legacyTypes = Array.from(
    { length: 100 },
    (_, index) => `legacy.external.${String(index).padStart(3, "0")}`,
  );
  await client.batch(
    legacyTypes.map((type) => ({
      sql: `INSERT INTO notification_preferences
        (account_id, type, channel, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["owner-legacy", type, "push", 1, "ts", "ts"],
    })),
    "write",
  );

  await ensureNotificationPreferences(db, "owner-legacy");

  const rows = await preferenceRows(client, "owner-legacy");
  const legacyRows = rows.filter((row) => row.type.startsWith("legacy.external."));
  expect(legacyRows).toHaveLength(100);
  expect(legacyRows.every((row) => !row.enabled)).toBe(true);
  expect(rows.filter((row) => NOTIFICATION_TYPES.includes(row.type as NotificationType)))
    .toHaveLength(NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length);
  expect(preferenceUpdates(statements).length).toBeGreaterThan(1);
  assertBoundedPreferenceInserts(statements);
  expect(statements.every((statement) => statement.parameterCount <= 90)).toBe(true);
});

async function rejectLaterInsert(client: Client) {
  // pr.comment follows five complete types, so its first row is in a later insert.
  await client.execute(`
    CREATE TRIGGER reject_later_preference BEFORE INSERT ON notification_preferences
    WHEN NEW.type = 'pr.comment'
    BEGIN SELECT RAISE(ABORT, 'injected later insert failure'); END
  `);
}

test("default creation rolls back earlier chunks when a later insert fails", async () => {
  const { db, client } = await makeBoundedDb();
  await rejectLaterInsert(client);

  await ensureNotificationPreferences(db, "owner-default-failure");

  expect(await preferenceRows(client, "owner-default-failure")).toHaveLength(0);
});

test("full preference update rejects and rolls back a later insert failure", async () => {
  const { db, client } = await makeBoundedDb();
  await rejectLaterInsert(client);
  const updates = NOTIFICATION_TYPES.flatMap((type) =>
    NOTIFICATION_CHANNELS.map((channel) => ({ type, channel, enabled: true }))
  );

  await expect(
    updateNotificationPreferences(db, "owner-update-failure", updates),
  ).rejects.toThrow("injected later insert failure");

  expect(await preferenceRows(client, "owner-update-failure")).toHaveLength(0);
});
