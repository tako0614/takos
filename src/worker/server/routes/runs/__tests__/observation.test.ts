import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../../../infra/db/schema.ts";
import type { Env } from "../../../../shared/types/index.ts";
import { MAX_EVENTS_PER_RESPONSE } from "../../../../shared/config/limits.ts";
import { RUN_EVENT_TRUNCATED_DATA } from "../../../../application/services/offload/run-events.ts";
import {
  loadRunObservation,
  parseRunReplayCursor,
} from "../observation.ts";

test("Run replay cursors accept only canonical safe decimal integers", () => {
  expect(parseRunReplayCursor(undefined)).toBe(0);
  expect(parseRunReplayCursor("0")).toBe(0);
  expect(parseRunReplayCursor("42")).toBe(42);
  expect(parseRunReplayCursor("42x")).toBeNull();
  expect(parseRunReplayCursor("-1")).toBeNull();
  expect(parseRunReplayCursor("01")).toBe(1);
  expect(parseRunReplayCursor(String(Number.MAX_SAFE_INTEGER + 1))).toBeNull();
});

async function observationDb() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      event_key TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return { client, db: drizzle(client, { schema }) };
}

test("Run observation pages D1 events and exposes continuation before terminal close", async () => {
  const { client, db } = await observationDb();
  try {
    await client.execute(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < 2002
      )
      INSERT INTO run_events (run_id, type, data, created_at)
      SELECT
        'run_1',
        CASE WHEN value = 2002 THEN 'completed' ELSE 'message' END,
        CASE WHEN value = 2002
          THEN '{"status":"completed"}'
          ELSE '{"ok":true}'
        END,
        '2026-08-10T00:00:00.000Z'
      FROM sequence
    `);

    const first = await loadRunObservation(
      { DB: db } as unknown as Env,
      "run_1",
      "completed",
      0,
    );
    expect(first.events).toHaveLength(MAX_EVENTS_PER_RESPONSE);
    expect(first.events[0].id).toBe(1);
    expect(first.events.at(-1)?.id).toBe(MAX_EVENTS_PER_RESPONSE);
    expect(first.truncation).toEqual({
      events: true,
      event_data: false,
      archive: false,
    });

    const second = await loadRunObservation(
      { DB: db } as unknown as Env,
      "run_1",
      "completed",
      MAX_EVENTS_PER_RESPONSE,
    );
    expect(second.events.map((event) => event.id)).toEqual([2001, 2002]);
    expect(second.events.at(-1)?.type).toBe("completed");
    expect(second.truncation).toEqual({
      events: false,
      event_data: false,
      archive: false,
    });
  } finally {
    client.close();
  }
});

test("Run observation retains event identity and marks oversized legacy data", async () => {
  const { client, db } = await observationDb();
  try {
    await client.execute({
      sql: `INSERT INTO run_events
        (run_id, type, data, created_at) VALUES (?, ?, ?, ?)`,
      args: [
        "run_1",
        "message",
        JSON.stringify({ value: "x".repeat(70 * 1024) }),
        "2026-08-10T00:00:00.000Z",
      ],
    });

    const observation = await loadRunObservation(
      { DB: db } as unknown as Env,
      "run_1",
      "running",
      0,
    );
    expect(observation.events).toHaveLength(1);
    expect(observation.events[0]).toMatchObject({
      id: 1,
      data: RUN_EVENT_TRUNCATED_DATA,
      data_truncated: true,
    });
    expect(observation.truncation.event_data).toBe(true);
  } finally {
    client.close();
  }
});
