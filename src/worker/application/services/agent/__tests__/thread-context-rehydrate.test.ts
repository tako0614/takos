import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Env } from "../../../../shared/types/index.ts";
import {
  indexThreadContext,
  queryRelevantThreadMessages,
} from "../thread-context.ts";

const NOW = "2026-08-10T12:00:00.000Z";

test("thread recall rehydrates vector hits from the canonical message", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO accounts (id, status) VALUES ('workspace-a', 'active');
    INSERT INTO threads (id, account_id, status)
      VALUES ('thread-a', 'workspace-a', 'active');
    INSERT INTO messages (id, thread_id, role, content, sequence, created_at)
      VALUES (
        'message-a',
        'thread-a',
        'user',
        'canonical current content',
        7,
        '${NOW}'
      );
  `);

  const db = drizzle(client, { schema });
  const env = {
    DB: db,
    AI: {
      run: async () => ({ data: [[0.1, 0.2]] }),
    },
    VECTORIZE: {
      query: async () => ({
        matches: [{
          id: "thread_msg:workspace-a:thread-a:7",
          score: 0.91,
          metadata: {
            kind: "thread_message",
            spaceId: "workspace-a",
            threadId: "thread-a",
            messageId: "message-a",
            sequence: 7,
            role: "system",
            createdAt: "2000-01-01T00:00:00.000Z",
            content: "forged stale vector content",
          },
        }],
      }),
    },
  } as unknown as Env;

  try {
    expect(
      await queryRelevantThreadMessages({
        env,
        spaceId: "workspace-a",
        threadId: "thread-a",
        query: "current",
        topK: 8,
        minScore: 0.35,
      }),
    ).toEqual([{
      id: "thread_msg:workspace-a:thread-a:7",
      score: 0.91,
      sequence: 7,
      role: "user",
      content: "canonical current content",
      createdAt: NOW,
      messageId: "message-a",
    }]);
  } finally {
    client.close();
  }
});

test("thread recall drops stale, cross-scope, deleted, and unsupported hits", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO accounts (id, status) VALUES
      ('workspace-a', 'active'),
      ('workspace-b', 'active'),
      ('workspace-suspended', 'suspended');
    INSERT INTO threads (id, account_id, status) VALUES
      ('thread-a', 'workspace-a', 'active'),
      ('thread-other', 'workspace-a', 'active'),
      ('thread-cross-workspace', 'workspace-b', 'active'),
      ('thread-deleted', 'workspace-a', 'deleted'),
      ('thread-suspended', 'workspace-suspended', 'active');
    INSERT INTO messages (id, thread_id, role, content, sequence, created_at)
      VALUES
      ('message-a', 'thread-a', 'assistant', 'valid', 1, '${NOW}'),
      ('message-other', 'thread-other', 'user', 'other thread', 2, '${NOW}'),
      ('message-cross', 'thread-cross-workspace', 'user', 'other workspace', 3, '${NOW}'),
      ('message-system', 'thread-a', 'system', 'unsupported', 4, '${NOW}'),
      ('message-deleted', 'thread-deleted', 'user', 'deleted', 5, '${NOW}'),
      ('message-suspended', 'thread-suspended', 'user', 'suspended', 6, '${NOW}');
  `);

  const db = drizzle(client, { schema });
  const matches = [
    {
      id: "thread_msg:workspace-a:thread-a:2",
      score: 0.99,
      metadata: {
        kind: "thread_message",
        spaceId: "workspace-a",
        threadId: "thread-a",
        messageId: "message-other",
        sequence: 2,
      },
    },
    {
      id: "thread_msg:workspace-a:thread-a:3",
      score: 0.98,
      metadata: {
        kind: "thread_message",
        spaceId: "workspace-a",
        threadId: "thread-a",
        messageId: "message-cross",
        sequence: 3,
      },
    },
    {
      id: "thread_msg:workspace-a:thread-a:999",
      score: 0.97,
      metadata: {
        kind: "thread_message",
        spaceId: "workspace-a",
        threadId: "thread-a",
        messageId: "message-a",
        sequence: 999,
      },
    },
    {
      id: "forged-vector-id",
      score: 0.96,
      metadata: {
        kind: "thread_message",
        spaceId: "workspace-a",
        threadId: "thread-a",
        messageId: "message-a",
        sequence: 1,
      },
    },
    {
      id: "thread_msg:workspace-a:thread-a:4",
      score: 0.95,
      metadata: {
        kind: "thread_message",
        spaceId: "workspace-a",
        threadId: "thread-a",
        messageId: "message-system",
        sequence: 4,
      },
    },
  ];
  const env = {
    DB: db,
    AI: { run: async () => ({ data: [[0.1, 0.2]] }) },
    VECTORIZE: { query: async () => ({ matches }) },
  } as unknown as Env;

  try {
    expect(
      await queryRelevantThreadMessages({
        env,
        spaceId: "workspace-a",
        threadId: "thread-a",
        query: "valid",
        topK: 8,
        minScore: 0.35,
      }),
    ).toEqual([]);

    const deletedEnv = {
      ...env,
      VECTORIZE: {
        query: async () => ({
          matches: [{
            id: "thread_msg:workspace-a:thread-deleted:5",
            score: 0.9,
            metadata: {
              kind: "thread_message",
              spaceId: "workspace-a",
              threadId: "thread-deleted",
              messageId: "message-deleted",
              sequence: 5,
            },
          }],
        }),
      },
    } as unknown as Env;
    expect(
      await queryRelevantThreadMessages({
        env: deletedEnv,
        spaceId: "workspace-a",
        threadId: "thread-deleted",
        query: "deleted",
        topK: 8,
        minScore: 0.35,
      }),
    ).toEqual([]);

    const suspendedEnv = {
      ...env,
      VECTORIZE: {
        query: async () => ({
          matches: [{
            id: "thread_msg:workspace-suspended:thread-suspended:6",
            score: 0.9,
            metadata: {
              kind: "thread_message",
              spaceId: "workspace-suspended",
              threadId: "thread-suspended",
              messageId: "message-suspended",
              sequence: 6,
            },
          }],
        }),
      },
    } as unknown as Env;
    expect(
      await queryRelevantThreadMessages({
        env: suspendedEnv,
        spaceId: "workspace-suspended",
        threadId: "thread-suspended",
        query: "suspended",
        topK: 8,
        minScore: 0.35,
      }),
    ).toEqual([]);
  } finally {
    client.close();
  }
});

test("thread indexing keeps message content out of Vectorize metadata", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      ai_model TEXT
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      retrieval_index INTEGER,
      summary TEXT,
      key_points TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO accounts (id, ai_model) VALUES ('workspace-a', NULL);
    INSERT INTO threads (
      id, account_id, retrieval_index, summary, key_points, updated_at
    ) VALUES ('thread-a', 'workspace-a', -1, NULL, '[]', '${NOW}');
    INSERT INTO messages (id, thread_id, role, content, sequence, created_at)
      VALUES
      ('message-a', 'thread-a', 'user', 'private canonical body', 1, '${NOW}'),
      ('message-b', 'thread-a', 'assistant', 'later body', 2, '${NOW}');
  `);

  const db = drizzle(client, { schema });
  const batches: unknown[][] = [];
  const env = {
    DB: db,
    AI: { run: async () => ({ data: [[0.1, 0.2]] }) },
    VECTORIZE: {
      upsert: async (batch: unknown[]) => {
        batches.push(batch);
      },
    },
  } as unknown as Env;

  try {
    expect(
      await indexThreadContext({
        env,
        spaceId: "workspace-a",
        threadId: "thread-a",
        maxMessages: 1,
      }),
    ).toMatchObject({ embedded: 1, lastSequence: 1, hasMore: true });
    expect(batches).toEqual([[
      {
        id: "thread_msg:workspace-a:thread-a:1",
        values: [0.1, 0.2],
        metadata: {
          kind: "thread_message",
          spaceId: "workspace-a",
          threadId: "thread-a",
          messageId: "message-a",
          sequence: 1,
        },
      },
    ]]);
  } finally {
    client.close();
  }
});
