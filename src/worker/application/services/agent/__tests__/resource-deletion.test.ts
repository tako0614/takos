import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Env } from "../../../../shared/types/index.ts";
import {
  findAgentResourceTombstone,
  prepareAgentResourceDeletion,
  runAgentResourceDeletionOutboxBatch,
} from "../resource-deletion.ts";

async function createFixture() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_context_revision INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE run_context_resource_refs (
      run_id TEXT NOT NULL,
      context_revision INTEGER NOT NULL,
      workspace_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, context_revision, resource_kind, resource_id)
    );
    CREATE TABLE tool_descriptor_revisions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      logical_name TEXT NOT NULL, source TEXT NOT NULL,
      adapter_reference TEXT NOT NULL, adapter_revision TEXT NOT NULL,
      schema_digest TEXT NOT NULL, descriptor_digest TEXT NOT NULL,
      descriptor_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE run_context_tool_descriptor_refs (
      run_id TEXT NOT NULL, context_revision INTEGER NOT NULL,
      workspace_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      resource_digest TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, context_revision, resource_id)
    );
    CREATE TABLE provider_materialization_revisions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, run_id TEXT NOT NULL,
      resource_id TEXT NOT NULL, source_kind TEXT NOT NULL,
      protocol TEXT NOT NULL, endpoint TEXT,
      materialization_digest TEXT NOT NULL, materialization_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE run_context_provider_materialization_refs (
      run_id TEXT NOT NULL, context_revision INTEGER NOT NULL,
      workspace_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      resource_digest TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, context_revision, resource_id)
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
  `);
  return { client, db: drizzle(client, { schema }) };
}

async function insertDeletion(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  input: {
    resourceId: string;
    vectorIds?: string;
    offloadObjectKeys?: string;
    status?: string;
    attempts?: number;
    claimedAt?: string | null;
    claimToken?: string | null;
  },
) {
  const prepared = await prepareAgentResourceDeletion({
    accountId: "space-a",
    resourceKind: "explicit_memory",
    resourceId: input.resourceId,
    source: { content: input.resourceId },
    deletedByAccountId: "user-a",
    deletedAt: "2026-08-10T00:00:00.000Z",
  });
  await fixture.client.batch([
    {
      sql: `INSERT INTO agent_resource_tombstones (
              id, account_id, resource_kind, resource_id, source_digest,
              deleted_by_account_id, deleted_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        prepared.id,
        prepared.accountId,
        prepared.resourceKind,
        prepared.resourceId,
        prepared.sourceDigest,
        prepared.deletedByAccountId,
        prepared.deletedAt,
        prepared.deletedAt,
      ],
    },
    {
      sql: `INSERT INTO agent_resource_deletion_outbox (
              id, account_id, resource_kind, resource_id, vector_ids,
              offload_object_keys, delivery_status, attempts, claim_token,
              claimed_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        prepared.id,
        prepared.accountId,
        prepared.resourceKind,
        prepared.resourceId,
        input.vectorIds ?? "[]",
        input.offloadObjectKeys ?? "[]",
        input.status ?? "pending",
        input.attempts ?? 0,
        input.claimToken ?? null,
        input.claimedAt ?? null,
        prepared.deletedAt,
        prepared.deletedAt,
      ],
    },
  ]);
  return prepared.id;
}

test("deletion outbox removes only captured exact targets and completes", async () => {
  const fixture = await createFixture();
  try {
    const id = await insertDeletion(fixture, {
      resourceId: "memory-a",
      vectorIds: '["vector-a","vector-b"]',
      offloadObjectKeys: '["memory/a","memory/b"]',
    });
    const vectorDeletes: string[][] = [];
    const objectDeletes: Array<string | string[]> = [];
    const summary = await runAgentResourceDeletionOutboxBatch({
      DB: fixture.db as unknown as Env["DB"],
      VECTORIZE: {
        deleteByIds: async (ids) => {
          vectorDeletes.push([...ids]);
          return {};
        },
      } as Env["VECTORIZE"],
      TAKOS_OFFLOAD: {
        delete: async (keys) => {
          objectDeletes.push(keys);
        },
      } as Env["TAKOS_OFFLOAD"],
    }, { ids: [id], limit: 1 });

    expect(summary).toEqual({
      selected: 1,
      claimed: 1,
      completed: 1,
      retrying: 0,
      failed: 0,
    });
    expect(vectorDeletes).toEqual([["vector-a", "vector-b"]]);
    expect(objectDeletes).toEqual([["memory/a", "memory/b"]]);
    const row = await fixture.client.execute({
      sql: `SELECT delivery_status, attempts, claim_token, completed_at
            FROM agent_resource_deletion_outbox WHERE id = ?`,
      args: [id],
    });
    expect(row.rows[0]?.delivery_status).toBe("done");
    expect(row.rows[0]?.attempts).toBe(1);
    expect(row.rows[0]?.claim_token).toBeNull();
    expect(row.rows[0]?.completed_at).not.toBeNull();
  } finally {
    fixture.client.close();
  }
});

test("tombstone lookup supports response-loss retry and refuses ambiguity", async () => {
  const fixture = await createFixture();
  try {
    const id = await insertDeletion(fixture, {
      resourceId: "memory-response-lost",
    });
    expect(
      await findAgentResourceTombstone(
        fixture.db,
        "explicit_memory",
        "memory-response-lost",
      ),
    ).toEqual({
      id,
      accountId: "space-a",
      resourceKind: "explicit_memory",
      resourceId: "memory-response-lost",
    });

    await fixture.client.execute({
      sql: `INSERT INTO agent_resource_tombstones (
              id, account_id, resource_kind, resource_id, source_digest,
              deleted_by_account_id, deleted_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "ardt_other-account",
        "space-b",
        "explicit_memory",
        "memory-response-lost",
        "sha256:other",
        "user-b",
        "2026-08-10T00:00:00.000Z",
        "2026-08-10T00:00:00.000Z",
      ],
    });
    expect(
      await findAgentResourceTombstone(
        fixture.db,
        "explicit_memory",
        "memory-response-lost",
      ),
    ).toBeNull();
  } finally {
    fixture.client.close();
  }
});

test("deletion outbox retries missing bindings without losing its tombstone", async () => {
  const fixture = await createFixture();
  try {
    const id = await insertDeletion(fixture, {
      resourceId: "memory-retry",
      vectorIds: '["vector-retry"]',
    });
    const summary = await runAgentResourceDeletionOutboxBatch({
      DB: fixture.db as unknown as Env["DB"],
    }, { ids: [id], limit: 1 });
    expect(summary.retrying).toBe(1);
    const row = await fixture.client.execute({
      sql: `SELECT delivery_status, attempts, next_attempt_at, last_error
            FROM agent_resource_deletion_outbox WHERE id = ?`,
      args: [id],
    });
    expect(row.rows[0]?.delivery_status).toBe("retry_wait");
    expect(row.rows[0]?.attempts).toBe(1);
    expect(row.rows[0]?.next_attempt_at).not.toBeNull();
    expect(row.rows[0]?.last_error).toBe(
      "Vector deletion binding is unavailable",
    );
    const tombstone = await fixture.client.execute({
      sql: "SELECT id FROM agent_resource_tombstones WHERE id = ?",
      args: [id],
    });
    expect(tombstone.rows).toHaveLength(1);
  } finally {
    fixture.client.close();
  }
});

test("malformed cleanup targets fail closed and concurrent drains claim once", async () => {
  const fixture = await createFixture();
  try {
    const corruptId = await insertDeletion(fixture, {
      resourceId: "memory-corrupt",
      vectorIds: '["b","a"]',
    });
    const corrupt = await runAgentResourceDeletionOutboxBatch({
      DB: fixture.db as unknown as Env["DB"],
      VECTORIZE: {
        deleteByIds: async () => ({}),
      } as unknown as Env["VECTORIZE"],
    }, { ids: [corruptId], limit: 1 });
    expect(corrupt.failed).toBe(1);

    const concurrentId = await insertDeletion(fixture, {
      resourceId: "memory-concurrent",
      vectorIds: '["only-once"]',
    });
    let calls = 0;
    const env = {
      DB: fixture.db as unknown as Env["DB"],
      VECTORIZE: {
        deleteByIds: async () => {
          calls++;
          await Promise.resolve();
          return {};
        },
      } as unknown as Env["VECTORIZE"],
    };
    const results = await Promise.all([
      runAgentResourceDeletionOutboxBatch(env, {
        ids: [concurrentId],
        limit: 1,
      }),
      runAgentResourceDeletionOutboxBatch(env, {
        ids: [concurrentId],
        limit: 1,
      }),
    ]);
    expect(results.reduce((sum, result) => sum + result.completed, 0)).toBe(1);
    expect(calls).toBe(1);
  } finally {
    fixture.client.close();
  }
});
