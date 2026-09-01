import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Env } from "../../../../shared/types/index.ts";
import { runAgentResourceDeletionOutboxBatch } from "../resource-deletion.ts";
import {
  materializeSemanticTurnProjection,
  queryRelevantSemanticTurnProjections,
  retireDeletedThreadTurnProjectionsBatch,
  SEMANTIC_TURN_PROJECTION_ALGORITHM_REVISION,
} from "../memory-projection.ts";

async function createFixture() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, status TEXT NOT NULL
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, status TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '2026-08-10T00:00:00.000Z'
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, thread_id TEXT NOT NULL,
      status TEXT NOT NULL, output TEXT, transcript_sequence_start INTEGER,
      current_context_revision INTEGER, created_at TEXT
    );
    CREATE TABLE run_context_revisions (
      run_id TEXT NOT NULL, revision INTEGER NOT NULL,
      transcript_cut_sequence INTEGER NOT NULL,
      PRIMARY KEY (run_id, revision)
    );
    CREATE TABLE run_context_resource_refs (
      run_id TEXT NOT NULL, context_revision INTEGER NOT NULL,
      workspace_id TEXT NOT NULL, resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL, resource_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, context_revision, resource_kind, resource_id)
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, tool_calls TEXT, tool_call_id TEXT,
      metadata TEXT, sequence INTEGER NOT NULL
    );
    CREATE TABLE turn_projection_revisions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, run_id TEXT NOT NULL,
      thread_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      projection_kind TEXT NOT NULL, format_version INTEGER NOT NULL,
      algorithm_revision TEXT NOT NULL, source_start_sequence INTEGER NOT NULL,
      source_end_sequence INTEGER NOT NULL, projection_digest TEXT NOT NULL,
      projection_json TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (account_id, run_id, projection_kind),
      UNIQUE (account_id, resource_id, projection_digest)
    );
    CREATE TABLE turn_projection_vector_refs (
      projection_id TEXT NOT NULL, account_id TEXT NOT NULL,
      vector_id TEXT NOT NULL UNIQUE, chunk_index INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL, chunk_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (projection_id, chunk_index),
      FOREIGN KEY (projection_id) REFERENCES turn_projection_revisions(id)
        ON DELETE CASCADE
    );
    CREATE TABLE agent_resource_tombstones (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL,
      source_digest TEXT NOT NULL, deleted_by_account_id TEXT,
      deleted_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE agent_resource_deletion_outbox (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL,
      vector_ids TEXT NOT NULL DEFAULT '[]',
      offload_object_keys TEXT NOT NULL DEFAULT '[]',
      delivery_status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, claim_token TEXT, claimed_at TEXT,
      next_attempt_at TEXT, completed_at TEXT, last_error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO accounts (id, status) VALUES
      ('space_a', 'active'), ('space_b', 'active');
    INSERT INTO threads (id, account_id, status) VALUES
      ('thread_a', 'space_a', 'active');
    INSERT INTO runs (
      id, account_id, thread_id, status, output, transcript_sequence_start
    ) VALUES (
      'run_a', 'space_a', 'thread_a', 'completed', NULL, 1
    );
    INSERT INTO run_context_revisions (
      run_id, revision, transcript_cut_sequence
    ) VALUES ('run_a', 1, 0);
    INSERT INTO messages (
      id, thread_id, role, content, tool_calls, tool_call_id, metadata, sequence
    ) VALUES
      ('message_user', 'thread_a', 'user', 'How should this work?', NULL, NULL,
       '{}', 0),
      ('message_assistant', 'thread_a', 'assistant', 'Use immutable turns.',
       NULL, NULL, '{"runId":"run_a"}', 1);
  `);
  const db = drizzle(client, { schema });
  const vectorWrites: Array<Array<{
    id: string;
    metadata?: Record<string, unknown>;
  }>> = [];
  const vectorDeletes: string[][] = [];
  const env = {
    DB: db,
    AI: {
      run: async (_model: string, input: { text: string[] }) => ({
        data: input.text.map(() => [0.1, 0.2, 0.3]),
      }),
    },
    VECTORIZE: {
      upsert: async (vectors: Array<{
        id: string;
        metadata?: Record<string, unknown>;
      }>) => {
        vectorWrites.push(vectors);
      },
      query: async () => ({
        matches: vectorWrites.flat().map((vector) => ({
          id: vector.id,
          score: 0.91,
          metadata: {
            ...vector.metadata,
            content: "forged vector metadata",
          },
        })),
      }),
      deleteByIds: async (ids: string[]) => {
        vectorDeletes.push(ids);
      },
    },
  } as unknown as Env;
  return { client, env, vectorWrites, vectorDeletes };
}

test("completed Runs dual-write one canonical semantic TurnProjection", async () => {
  const fixture = await createFixture();
  try {
    const first = await materializeSemanticTurnProjection({
      env: fixture.env,
      workspaceId: "space_a",
      runId: "run_a",
    });
    expect(first).toEqual({ created: true, vectorCount: 1 });
    const projections = await fixture.client.execute(
      "SELECT * FROM turn_projection_revisions WHERE run_id = 'run_a'",
    );
    expect(projections.rows).toHaveLength(1);
    const snapshot = JSON.parse(
      String(projections.rows[0]?.projection_json),
    ) as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      projectionKind: "semantic_turn",
      algorithmRevision: SEMANTIC_TURN_PROJECTION_ALGORITHM_REVISION,
      runId: "run_a",
      workspaceId: "space_a",
      threadId: "thread_a",
      sourceStartSequence: 0,
      sourceEndSequence: 1,
      sourceTruncated: false,
      messages: [
        { role: "user", content: "How should this work?" },
        { role: "assistant", content: "Use immutable turns." },
      ],
    });
    expect(fixture.vectorWrites).toHaveLength(1);
    expect(fixture.vectorWrites[0]).toHaveLength(1);
    expect(fixture.vectorWrites[0]?.[0]?.metadata).not.toHaveProperty("content");
    expect(fixture.vectorWrites[0]?.[0]?.metadata).toMatchObject({
      kind: "turn_projection",
      workspaceId: "space_a",
      threadId: "thread_a",
      runId: "run_a",
      chunkIndex: 0,
      chunkCount: 1,
    });

    await fixture.client.execute(
      "UPDATE messages SET content = 'mutable rewrite' WHERE id = 'message_assistant'",
    );
    const replay = await materializeSemanticTurnProjection({
      env: fixture.env,
      workspaceId: "space_a",
      runId: "run_a",
    });
    expect(replay).toEqual({ created: false, vectorCount: 1 });
    const unchanged = await fixture.client.execute(
      "SELECT projection_json FROM turn_projection_revisions WHERE run_id = 'run_a'",
    );
    expect(String(unchanged.rows[0]?.projection_json)).toContain(
      "Use immutable turns.",
    );
    expect(String(unchanged.rows[0]?.projection_json)).not.toContain(
      "mutable rewrite",
    );
    expect(
      await materializeSemanticTurnProjection({
        env: fixture.env,
        workspaceId: "space_b",
        runId: "run_a",
      }),
    ).toBeNull();
  } finally {
    fixture.client.close();
  }
});

test("semantic TurnProjection vectorization is bounded to three content-free chunks", async () => {
  const fixture = await createFixture();
  try {
    await fixture.client.execute(
      "UPDATE messages SET content = ? WHERE id = 'message_assistant'",
      [`paragraph ${"x".repeat(13_000)}`],
    );
    const result = await materializeSemanticTurnProjection({
      env: fixture.env,
      workspaceId: "space_a",
      runId: "run_a",
    });
    expect(result).toEqual({ created: true, vectorCount: 3 });
    const refs = await fixture.client.execute(
      "SELECT vector_id, chunk_index, chunk_count, chunk_digest FROM turn_projection_vector_refs ORDER BY chunk_index",
    );
    expect(refs.rows).toHaveLength(3);
    expect(refs.rows.map((row) => Number(row.chunk_index))).toEqual([0, 1, 2]);
    expect(refs.rows.every((row) => Number(row.chunk_count) === 3)).toBe(true);
    expect(refs.rows.every((row) =>
      String(row.chunk_digest).startsWith("sha256:")
    )).toBe(true);
    expect(fixture.vectorWrites[0]?.every((vector) =>
      !Object.hasOwn(vector.metadata ?? {}, "content")
    )).toBe(true);
  } finally {
    fixture.client.close();
  }
});

test("semantic vector identities persist before a retryable provider failure", async () => {
  const fixture = await createFixture();
  try {
    const vectorize = fixture.env.VECTORIZE as NonNullable<Env["VECTORIZE"]>;
    const originalUpsert = vectorize.upsert.bind(vectorize);
    vectorize.upsert = async () => {
      throw new Error("lost provider response");
    };
    await expect(materializeSemanticTurnProjection({
      env: fixture.env,
      workspaceId: "space_a",
      runId: "run_a",
    })).rejects.toThrow("lost provider response");
    const refsAfterFailure = await fixture.client.execute(
      "SELECT vector_id FROM turn_projection_vector_refs",
    );
    expect(refsAfterFailure.rows).toHaveLength(1);

    vectorize.upsert = originalUpsert;
    expect(await materializeSemanticTurnProjection({
      env: fixture.env,
      workspaceId: "space_a",
      runId: "run_a",
    })).toEqual({ created: false, vectorCount: 1 });
    expect(fixture.vectorWrites).toHaveLength(1);
  } finally {
    fixture.client.close();
  }
});

test("deleted Threads retire projections through exact tombstones and outbox targets", async () => {
  const fixture = await createFixture();
  try {
    await materializeSemanticTurnProjection({
      env: fixture.env,
      workspaceId: "space_a",
      runId: "run_a",
    });
    await fixture.client.execute({
      sql: `INSERT INTO turn_projection_revisions (
        id, account_id, run_id, thread_id, resource_id, projection_kind,
        format_version, algorithm_revision, source_start_sequence,
        source_end_sequence, projection_digest, projection_json, created_at
      ) VALUES (
        'foreign_projection', 'space_b', 'run_foreign', 'thread_a',
        'foreign_projection', 'run_model_input', 1,
        'takos.run_model_input.v1', -1, 1,
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '{}', '2026-08-10T00:00:00.000Z'
      )`,
      args: [],
    });
    await fixture.client.execute(
      "UPDATE threads SET status = 'deleted' WHERE id = 'thread_a'",
    );
    const retired = await retireDeletedThreadTurnProjectionsBatch(
      fixture.env.DB,
      {
        threadId: "thread_a",
        deletedByAccountId: "user_a",
      },
    );
    expect(retired).toEqual({ selected: 1, retired: 1, remaining: false });
    const remaining = await fixture.client.execute(
      "SELECT id FROM turn_projection_revisions ORDER BY id",
    );
    expect(remaining.rows.map((row) => String(row.id))).toEqual([
      "foreign_projection",
    ]);
    const tombstones = await fixture.client.execute(
      `SELECT resource_kind, resource_id, deleted_by_account_id
         FROM agent_resource_tombstones`,
    );
    expect(tombstones.rows).toHaveLength(1);
    expect(tombstones.rows[0]).toMatchObject({
      resource_kind: "turn_projection",
      deleted_by_account_id: "user_a",
    });
    const outbox = await fixture.client.execute(
      `SELECT vector_ids, offload_object_keys, delivery_status
         FROM agent_resource_deletion_outbox`,
    );
    expect(outbox.rows).toHaveLength(1);
    const vectorIds = JSON.parse(String(outbox.rows[0]?.vector_ids));
    expect(vectorIds).toHaveLength(3);
    expect(vectorIds).toEqual([...vectorIds].sort());
    expect(vectorIds.every((id: unknown) =>
      typeof id === "string" && id.startsWith("turn_projection:")
    )).toBe(true);
    expect(outbox.rows[0]).toMatchObject({
      offload_object_keys: "[]",
      delivery_status: "pending",
    });
    const refs = await fixture.client.execute(
      "SELECT vector_id FROM turn_projection_vector_refs",
    );
    expect(refs.rows).toHaveLength(0);
    expect(await runAgentResourceDeletionOutboxBatch(fixture.env, {
      limit: 1,
    })).toEqual({
      selected: 1,
      claimed: 1,
      completed: 1,
      retrying: 0,
      failed: 0,
    });
    expect(fixture.vectorDeletes).toEqual([vectorIds]);
    expect(await retireDeletedThreadTurnProjectionsBatch(
      fixture.env.DB,
      { threadId: "thread_a" },
    )).toEqual({ selected: 0, retired: 0, remaining: false });
  } finally {
    fixture.client.close();
  }
});

test("concurrent TurnProjection retirement converges on one deletion identity", async () => {
  const fixture = await createFixture();
  try {
    await materializeSemanticTurnProjection({
      env: fixture.env,
      workspaceId: "space_a",
      runId: "run_a",
    });
    await fixture.client.execute(
      "UPDATE threads SET status = 'deleted' WHERE id = 'thread_a'",
    );
    const outcomes = await Promise.all([
      retireDeletedThreadTurnProjectionsBatch(fixture.env.DB, {
        threadId: "thread_a",
        deletedByAccountId: "user_a",
      }),
      retireDeletedThreadTurnProjectionsBatch(fixture.env.DB, {
        threadId: "thread_a",
        deletedByAccountId: "user_a",
      }),
    ]);
    expect(outcomes.some((outcome) => outcome.selected === 1)).toBe(true);
    const evidence = await fixture.client.execute(
      `SELECT
        (SELECT COUNT(*) FROM turn_projection_revisions) AS projections,
        (SELECT COUNT(*) FROM agent_resource_tombstones) AS tombstones,
        (SELECT COUNT(*) FROM agent_resource_deletion_outbox) AS outbox_rows`,
    );
    expect(evidence.rows[0]).toMatchObject({
      projections: 0,
      tombstones: 1,
      outbox_rows: 1,
    });
  } finally {
    fixture.client.close();
  }
});

test("semantic recall rehydrates canonical turns and excludes tombstoned hits", async () => {
  const fixture = await createFixture();
  try {
    await materializeSemanticTurnProjection({
      env: fixture.env,
      workspaceId: "space_a",
      runId: "run_a",
    });
    const turns = await queryRelevantSemanticTurnProjections({
      env: fixture.env,
      workspaceId: "space_a",
      currentRunId: "run_current",
      currentThreadId: "thread_a",
      transcriptCutSequence: 502,
      query: "immutable turns",
      limit: 5,
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.messages).toEqual([
      { role: "user", content: "How should this work?" },
      { role: "assistant", content: "Use immutable turns." },
    ]);
    expect(JSON.stringify(turns)).not.toContain("forged vector metadata");
    expect(
      await queryRelevantSemanticTurnProjections({
        env: fixture.env,
        workspaceId: "space_a",
        currentRunId: "run_current",
        currentThreadId: "thread_other",
        transcriptCutSequence: 502,
        query: "immutable turns",
        limit: 5,
      }),
    ).toEqual([]);
    expect(
      await queryRelevantSemanticTurnProjections({
        env: fixture.env,
        workspaceId: "space_b",
        currentRunId: "run_current",
        currentThreadId: "thread_a",
        transcriptCutSequence: 502,
        query: "immutable turns",
        limit: 5,
      }),
    ).toEqual([]);

    const projection = await fixture.client.execute(
      "SELECT resource_id, projection_digest FROM turn_projection_revisions WHERE run_id = 'run_a'",
    );
    await fixture.client.execute({
      sql: `INSERT INTO agent_resource_tombstones (
        id, account_id, resource_kind, resource_id, source_digest,
        deleted_at, created_at
      ) VALUES ('tombstone_a', 'space_a', 'turn_projection', ?, ?,
        '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z')`,
      args: [
        String(projection.rows[0]?.resource_id),
        String(projection.rows[0]?.projection_digest),
      ],
    });
    expect(
      await queryRelevantSemanticTurnProjections({
        env: fixture.env,
        workspaceId: "space_a",
        currentRunId: "run_current",
        currentThreadId: "thread_a",
        transcriptCutSequence: 502,
        query: "immutable turns",
        limit: 5,
      }),
    ).toEqual([]);
  } finally {
    fixture.client.close();
  }
});
