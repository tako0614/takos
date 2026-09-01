import { expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { ObjectStoreBinding } from "../../../../shared/types/bindings.ts";
import type { Env } from "../../../../shared/types/index.ts";
import {
  writeUsageEventArchiveManifestToR2,
  writeUsageEventSegmentToR2,
} from "../../offload/usage-events.ts";
import { recordAppUsage, recordRunUsageBatch } from "../usage-recorder.ts";

const TEST_DDL = `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    owner_account_id TEXT
  );
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    usage TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE app_usage_events (
    id TEXT PRIMARY KEY NOT NULL,
    idempotency_key TEXT,
    owner_account_id TEXT NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'space',
    space_id TEXT,
    meter_type TEXT NOT NULL,
    units REAL NOT NULL,
    reference_id TEXT,
    reference_type TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_app_usage_events_idempotency_key
    ON app_usage_events (idempotency_key);
  CREATE TABLE app_usage_rollups (
    id TEXT PRIMARY KEY NOT NULL,
    owner_account_id TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    space_id TEXT,
    meter_type TEXT NOT NULL,
    period_start TEXT NOT NULL,
    units REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_app_usage_rollups_scope
    ON app_usage_rollups (
      owner_account_id,
      scope_type,
      scope_id,
      meter_type,
      period_start
    );
`;

function memoryBucket() {
  const encoder = new TextEncoder();
  const objects = new Map<string, Uint8Array>();
  return {
    async put(key: string, value: string | ArrayBuffer | ArrayBufferView) {
      const bytes = typeof value === "string"
        ? encoder.encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value.slice(0))
          : new Uint8Array(
            value.buffer.slice(
              value.byteOffset,
              value.byteOffset + value.byteLength,
            ),
          );
      objects.set(key, bytes);
      return null;
    },
    async get(key: string) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        size: value.byteLength,
        async arrayBuffer() {
          return value.buffer.slice(
            value.byteOffset,
            value.byteOffset + value.byteLength,
          );
        },
        async text() {
          return new TextDecoder().decode(value);
        },
      };
    },
  } as unknown as ObjectStoreBinding;
}

async function createFixture() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(TEST_DDL);
  const db = drizzle(client, { schema });
  return { client, db };
}

async function usageRows(client: Client) {
  return client.execute(`
    SELECT owner_account_id, space_id, meter_type, units
    FROM app_usage_events
    ORDER BY meter_type
  `);
}

test("app usage event and rollup share one idempotent atomic batch", async () => {
  const fixture = await createFixture();
  try {
    const first = await recordAppUsage(fixture.db as never, {
      ownerAccountId: "owner_1",
      spaceId: "space_1",
      meterType: "exec_seconds",
      units: 4,
      idempotencyKey: "usage_1",
    });
    const replay = await recordAppUsage(fixture.db as never, {
      ownerAccountId: "owner_1",
      spaceId: "space_1",
      meterType: "exec_seconds",
      units: 4,
      idempotencyKey: "usage_1",
    });
    expect(first.applied).toBe(true);
    expect(replay.applied).toBe(false);

    const events = await fixture.client.execute(
      "SELECT id FROM app_usage_events",
    );
    const rollups = await fixture.client.execute(
      "SELECT units FROM app_usage_rollups",
    );
    expect(events.rows).toHaveLength(1);
    expect(rollups.rows).toHaveLength(1);
    expect(Number(rollups.rows[0]?.units)).toBe(4);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(recordAppUsage(fixture.db as never, {
      ownerAccountId: "owner_1",
      meterType: "queue_messages",
      units: 1,
      metadata: circular,
    })).rejects.toThrow("App usage metadata must be JSON serializable");
    expect((await fixture.client.execute(
      "SELECT id FROM app_usage_events",
    )).rows).toHaveLength(1);
  } finally {
    fixture.client.close();
  }
});

test("app usage rolls back its event when the rollup write fails", async () => {
  const fixture = await createFixture();
  try {
    await fixture.client.executeMultiple(`
      CREATE TRIGGER reject_usage_rollup
      BEFORE INSERT ON app_usage_rollups
      BEGIN
        SELECT RAISE(ABORT, 'test rollup failure');
      END;
    `);
    await expect(recordAppUsage(fixture.db as never, {
      ownerAccountId: "owner_1",
      spaceId: "space_1",
      meterType: "exec_seconds",
      units: 4,
      idempotencyKey: "usage_atomic",
    })).rejects.toThrow();
    expect((await fixture.client.execute(
      "SELECT id FROM app_usage_events",
    )).rows).toHaveLength(0);
    expect((await fixture.client.execute(
      "SELECT id FROM app_usage_rollups",
    )).rows).toHaveLength(0);
  } finally {
    fixture.client.close();
  }
});

test("Run usage waits for a complete archive and keeps SQL tokens authoritative", async () => {
  const fixture = await createFixture();
  const bucket = memoryBucket();
  const env = {
    DB: fixture.db,
    TAKOS_OFFLOAD: bucket,
  } as unknown as Env;
  try {
    await fixture.client.execute(`
      INSERT INTO accounts (id, owner_account_id)
      VALUES ('space_1', 'owner_1')
    `);
    await fixture.client.execute({
      sql: `INSERT INTO runs (id, account_id, usage) VALUES (?, ?, ?)`,
      args: [
        "run_1",
        "space_1",
        JSON.stringify({ inputTokens: 2000, outputTokens: 1000 }),
      ],
    });

    await recordRunUsageBatch(env, "run_1");
    let rows = await usageRows(fixture.client);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => [row.meter_type, Number(row.units)]))
      .toEqual([
        ["llm_tokens_input", 2],
        ["llm_tokens_output", 1],
      ]);
    expect(rows.rows.every((row) => row.owner_account_id === "owner_1"))
      .toBe(true);
    expect(rows.rows.every((row) => row.space_id === "space_1")).toBe(true);

    const createdAt = "2026-08-10T00:00:00.000Z";
    await writeUsageEventSegmentToR2(bucket, "run_1", 1, [
      {
        meter_type: "exec_seconds",
        units: 1,
        reference_type: "run",
        metadata: null,
        created_at: createdAt,
      },
      {
        meter_type: "exec_seconds",
        units: 2,
        reference_type: "run",
        metadata: null,
        created_at: createdAt,
      },
      {
        meter_type: "llm_tokens_input",
        units: 99,
        reference_type: "run",
        metadata: null,
        created_at: createdAt,
      },
    ]);
    await writeUsageEventArchiveManifestToR2(bucket, "run_1", {
      segmentCount: 1,
      eventCount: 3,
      completedAt: "2026-08-10T00:01:00.000Z",
    });

    await recordRunUsageBatch(env, "run_1");
    await recordRunUsageBatch(env, "run_1");
    rows = await usageRows(fixture.client);
    expect(rows.rows.map((row) => [row.meter_type, Number(row.units)]))
      .toEqual([
        ["exec_seconds", 3],
        ["llm_tokens_input", 2],
        ["llm_tokens_output", 1],
      ]);

    const rollups = await fixture.client.execute(`
      SELECT owner_account_id, scope_id, meter_type, units
      FROM app_usage_rollups
      ORDER BY meter_type
    `);
    expect(rollups.rows.map((row) => [
      row.owner_account_id,
      row.scope_id,
      row.meter_type,
      Number(row.units),
    ])).toEqual([
      ["owner_1", "space_1", "exec_seconds", 3],
      ["owner_1", "space_1", "llm_tokens_input", 2],
      ["owner_1", "space_1", "llm_tokens_output", 1],
    ]);
  } finally {
    fixture.client.close();
  }
});
