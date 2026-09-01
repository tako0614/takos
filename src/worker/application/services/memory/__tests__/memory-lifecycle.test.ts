import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Env } from "../../../../shared/types/index.ts";
import * as schema from "../../../../infra/db/schema.ts";
import {
  bumpMemoryAccess,
  createMemory,
  createReminder,
  deleteMemory,
  deleteReminder,
  explicitMemoryResourceReference,
  getMemoryById,
  memoryServiceDeps,
  triggerReminder,
  updateMemory,
  updateReminder,
} from "../memories.ts";
import { rememberHandler } from "../../../tools/custom/memory.ts";

let client: Client;
let binding: Env["DB"];
let nextId = 0;
const originalDeps = { ...memoryServiceDeps };

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      author_account_id TEXT,
      thread_id TEXT,
      type TEXT NOT NULL,
      category TEXT,
      content TEXT NOT NULL,
      summary TEXT,
      importance REAL DEFAULT 0.5,
      tags TEXT,
      occurred_at TEXT,
      expires_at TEXT,
      last_accessed_at TEXT,
      access_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_resource_tombstones (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      source_digest TEXT NOT NULL,
      deleted_by_account_id TEXT,
      deleted_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (account_id, resource_kind, resource_id)
    );
    CREATE TABLE agent_resource_deletion_outbox (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      vector_ids TEXT NOT NULL DEFAULT '[]',
      offload_object_keys TEXT NOT NULL DEFAULT '[]',
      delivery_status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      claim_token TEXT,
      claimed_at TEXT,
      next_attempt_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (account_id, resource_kind, resource_id)
    );
    CREATE TABLE reminders (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      owner_account_id TEXT,
      content TEXT NOT NULL,
      context TEXT,
      trigger_type TEXT NOT NULL,
      trigger_value TEXT,
      status TEXT DEFAULT 'pending',
      triggered_at TEXT,
      priority TEXT DEFAULT 'normal',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const db = drizzle(client, { schema });
  binding = {} as Env["DB"];
  memoryServiceDeps.getDb = (() => db) as typeof memoryServiceDeps.getDb;
  memoryServiceDeps.generateId = () => `record-${++nextId}`;
  memoryServiceDeps.now = () => "2026-08-09T20:00:00.000Z";
});

afterEach(() => {
  Object.assign(memoryServiceDeps, originalDeps);
  client.close();
});

test("Memory and Reminder creation returns the inserted records", async () => {
  const memory = await createMemory(binding, {
    spaceId: "space-a",
    userId: "user-a",
    type: "semantic",
    content: "Remember the exact product boundary.",
  });
  expect(memory?.importance).toBe(0.5);
  expect(memory?.space_id).toBe("space-a");
  expect((await getMemoryById(binding, memory!.id))?.id).toBe(memory?.id);

  const reminder = await createReminder(binding, {
    spaceId: "space-a",
    userId: "user-a",
    content: "Review the release evidence.",
    triggerType: "time",
    triggerValue: "2026-08-10T09:00:00.000Z",
  });
  expect(reminder?.space_id).toBe("space-a");
  expect(reminder?.status).toBe("pending");

  await rememberHandler({
    content: "Zero importance is intentional.",
    type: "semantic",
    importance: 0,
  }, {
    spaceId: "space-a",
    userId: "user-a",
    threadId: "thread-a",
    runId: "run-a",
    capabilities: [],
    env: {} as Env,
    db: binding,
  });
  const zeroImportance = await client.execute({
    sql: "SELECT importance FROM memories WHERE content = ?",
    args: ["Zero importance is intentional."],
  });
  expect(zeroImportance.rows[0]?.importance).toBe(0);
});

test("Memory and Reminder mutations are fenced by Workspace", async () => {
  await client.executeMultiple(`
    INSERT INTO memories (
      id, account_id, author_account_id, type, content, importance,
      occurred_at, access_count, created_at, updated_at
    ) VALUES
      ('memory-a', 'space-a', 'user-a', 'semantic', 'A', 0.5,
       '2026-08-09T20:00:00.000Z', 0,
       '2026-08-09T20:00:00.000Z', '2026-08-09T20:00:00.000Z'),
      ('memory-b', 'space-b', 'user-b', 'semantic', 'B', 0.5,
       '2026-08-09T20:00:00.000Z', 0,
       '2026-08-09T20:00:00.000Z', '2026-08-09T20:00:00.000Z');
    INSERT INTO reminders (
      id, account_id, owner_account_id, content, trigger_type, trigger_value,
      status, priority, created_at, updated_at
    ) VALUES
      ('reminder-a', 'space-a', 'user-a', 'A', 'time', 'tomorrow',
       'pending', 'normal', '2026-08-09T20:00:00.000Z',
       '2026-08-09T20:00:00.000Z'),
      ('reminder-b', 'space-b', 'user-b', 'B', 'time', 'tomorrow',
       'pending', 'normal', '2026-08-09T20:00:00.000Z',
       '2026-08-09T20:00:00.000Z');
  `);

  expect(
    await updateMemory(binding, "space-a", "memory-b", { content: "pwned" }),
  ).toBeNull();
  expect(
    await deleteMemory(binding, "space-a", "memory-b", "user-a"),
  ).toBeNull();
  expect((await getMemoryById(binding, "memory-b"))?.content).toBe("B");
  expect(
    (await updateMemory(binding, "space-a", "memory-a", { content: "A2" }))
      ?.content,
  ).toBe("A2");

  expect(
    await updateReminder(
      binding,
      "space-a",
      "reminder-b",
      { content: "pwned" },
    ),
  ).toBeNull();
  expect(
    await triggerReminder(binding, "space-a", "reminder-b"),
  ).toBeNull();
  await deleteReminder(binding, "space-a", "reminder-b");
  const foreignReminder = await client.execute({
    sql: "SELECT content, status FROM reminders WHERE id = ?",
    args: ["reminder-b"],
  });
  expect(foreignReminder.rows[0]).toMatchObject({
    content: "B",
    status: "pending",
  });
  expect(
    (await triggerReminder(binding, "space-a", "reminder-a"))?.status,
  ).toBe("triggered");
});

test("Memory deletion commits a content-free tombstone and cleanup outbox atomically", async () => {
  await client.execute(`
    INSERT INTO memories (
      id, account_id, author_account_id, thread_id, type, category, content,
      summary, importance, tags, occurred_at, access_count, created_at,
      updated_at
    ) VALUES (
      'memory-delete', 'space-a', 'user-a', 'thread-a', 'semantic', 'private',
      'sensitive source content', 'sensitive summary', 0.8, '["secret"]',
      '2026-08-09T20:00:00.000Z', 2, '2026-08-09T20:00:00.000Z',
      '2026-08-09T20:00:00.000Z'
    )
  `);

  const deleted = await deleteMemory(
    binding,
    "space-a",
    "memory-delete",
    "user-a",
  );
  expect(deleted?.tombstoneId).toMatch(/^ardt_[a-f0-9]{64}$/);
  expect(await getMemoryById(binding, "memory-delete")).toBeNull();

  const tombstone = await client.execute({
    sql: `SELECT account_id, resource_kind, resource_id, source_digest,
                 deleted_by_account_id
          FROM agent_resource_tombstones WHERE id = ?`,
    args: [deleted!.tombstoneId],
  });
  expect(tombstone.rows[0]).toMatchObject({
    account_id: "space-a",
    resource_kind: "explicit_memory",
    resource_id: "memory-delete",
    deleted_by_account_id: "user-a",
  });
  expect(tombstone.rows[0]?.source_digest).toMatch(/^sha256:[a-f0-9]{64}$/);

  const outbox = await client.execute({
    sql: `SELECT vector_ids, offload_object_keys, delivery_status, attempts
          FROM agent_resource_deletion_outbox WHERE id = ?`,
    args: [deleted!.tombstoneId],
  });
  expect(outbox.rows[0]).toMatchObject({
    vector_ids: "[]",
    offload_object_keys: "[]",
    delivery_status: "pending",
    attempts: 0,
  });
  expect(JSON.stringify([...tombstone.rows, ...outbox.rows])).not.toContain(
    "sensitive source content",
  );
});

test("Memory access telemetry does not manufacture a semantic resource revision", async () => {
  const created = await createMemory(binding, {
    spaceId: "space-1",
    userId: "user-1",
    threadId: "thread-1",
    type: "semantic",
    category: "preference",
    content: "Use concise status updates",
    summary: "Concise status updates",
    importance: 0.8,
  });
  const before = await explicitMemoryResourceReference(created);
  const updatedAt = created.updated_at;

  await bumpMemoryAccess(binding, [created.id], "2026-08-10T00:00:00.000Z");
  const afterRead = await getMemoryById(binding, created.id);
  if (!afterRead) throw new Error("Expected Memory after access telemetry");
  const after = await explicitMemoryResourceReference(afterRead);

  expect(afterRead.access_count).toBe(1);
  expect(afterRead.last_accessed_at).toBe("2026-08-10T00:00:00.000Z");
  expect(afterRead.updated_at).toBe(updatedAt);
  expect(after).toEqual(before);
});
