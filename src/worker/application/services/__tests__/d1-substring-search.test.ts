import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and } from "drizzle-orm";

import * as schema from "../../../infra/db/schema.ts";
import {
  repositories,
  type SqlDatabaseLike,
} from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import { searchMemories } from "../memory/memories.ts";
import {
  quickSearchPaths,
  searchFilenames,
} from "../source/search.ts";
import { buildBaseConditions } from "../source/source-exploration.ts";
import {
  searchSpaceThreads,
  searchThreadMessages,
} from "../threads/thread-search.ts";

const LONG_LITERAL_QUERY = `Literal%_\\Needle-${"x".repeat(64)}`;

function upper(value: string): string {
  return value.toUpperCase();
}

test("D1 substring searches accept long input and keep LIKE metacharacters literal", async () => {
  expect(new TextEncoder().encode(LONG_LITERAL_QUERY).byteLength).toBeGreaterThan(
    50,
  );

  const client = createClient({ url: ":memory:" });
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
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE files (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      path TEXT NOT NULL,
      sha256 TEXT,
      mime_type TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      origin TEXT NOT NULL DEFAULT 'user',
      kind TEXT NOT NULL DEFAULT 'source',
      visibility TEXT NOT NULL DEFAULT 'private',
      indexed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE repositories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      visibility TEXT NOT NULL
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
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
  `);

  const exact = upper(LONG_LITERAL_QUERY);
  const wildcardDecoy = upper(
    LONG_LITERAL_QUERY.replace("%_", "unrelated"),
  );
  const now = "2026-07-29T00:00:00.000Z";
  await client.batch([
    {
      sql: "INSERT INTO accounts (id, status) VALUES ('space_a', 'active'), ('space_b', 'active')",
      args: [],
    },
    {
      sql: `INSERT INTO memories
        (id, account_id, type, content, importance, created_at, updated_at)
        VALUES (?, 'space_a', 'semantic', ?, 1, ?, ?)`,
      args: ["memory_content", `before ${exact} after`, now, now],
    },
    {
      sql: `INSERT INTO memories
        (id, account_id, type, content, summary, importance, created_at, updated_at)
        VALUES (?, 'space_a', 'semantic', 'different content', ?, 0.9, ?, ?)`,
      args: ["memory_summary", `summary ${exact}`, now, now],
    },
    {
      sql: `INSERT INTO memories
        (id, account_id, type, content, importance, created_at, updated_at)
        VALUES (?, 'space_a', 'semantic', ?, 0.8, ?, ?)`,
      args: ["memory_decoy", wildcardDecoy, now, now],
    },
    {
      sql: `INSERT INTO files
        (id, account_id, path, size, origin, kind, created_at, updated_at)
        VALUES (?, 'space_a', ?, 1, 'user', 'source', ?, ?)`,
      args: ["file_exact", `src/${exact}.ts`, now, now],
    },
    {
      sql: `INSERT INTO files
        (id, account_id, path, size, origin, kind, created_at, updated_at)
        VALUES (?, 'space_a', ?, 1, 'user', 'source', ?, ?)`,
      args: ["file_decoy", `src/${wildcardDecoy}.ts`, now, now],
    },
    {
      sql: "INSERT INTO repositories (id, name, visibility) VALUES (?, ?, 'public')",
      args: ["repo_exact", `repo-${exact}`],
    },
    {
      sql: "INSERT INTO repositories (id, name, visibility) VALUES (?, ?, 'public')",
      args: ["repo_decoy", `repo-${wildcardDecoy}`],
    },
    {
      sql: `INSERT INTO threads
        (id, account_id, title, status, created_at, updated_at)
        VALUES ('thread_a', 'space_a', 'Thread', 'active', ?, ?)`,
      args: [now, now],
    },
    {
      sql: `INSERT INTO messages
        (id, thread_id, role, content, sequence, created_at)
        VALUES ('message_exact', 'thread_a', 'user', ?, 1, ?)`,
      args: [`message ${exact}`, now],
    },
    {
      sql: `INSERT INTO messages
        (id, thread_id, role, content, sequence, created_at)
        VALUES ('message_decoy', 'thread_a', 'user', ?, 2, ?)`,
      args: [`message ${wildcardDecoy}`, now],
    },
    {
      sql: `INSERT INTO threads
        (id, account_id, title, status, created_at, updated_at)
        VALUES ('thread_b', 'space_b', 'Other workspace', 'active', ?, ?)`,
      args: [now, now],
    },
    {
      sql: `INSERT INTO messages
        (id, thread_id, role, content, sequence, created_at)
        VALUES ('message_b', 'thread_b', 'assistant', 'private other workspace', 1, ?)`,
      args: [now],
    },
  ]);

  const db = drizzle(client, { schema });
  const binding = db as unknown as SqlDatabaseLike;
  try {
    const memoryResults = await searchMemories(
      binding as unknown as Env["DB"],
      "space_a",
      LONG_LITERAL_QUERY,
    );
    expect(memoryResults.map((memory) => memory.id)).toEqual([
      "memory_content",
      "memory_summary",
    ]);

    expect(
      await quickSearchPaths(binding, "space_a", LONG_LITERAL_QUERY),
    ).toEqual([`src/${exact}.ts`]);
    expect(
      (await searchFilenames(binding, "space_a", LONG_LITERAL_QUERY)).map(
        (result) => result.file.id,
      ),
    ).toEqual(["file_exact"]);

    const repoRows = await db.select({ id: repositories.id })
      .from(repositories)
      .where(and(...buildBaseConditions({ searchQuery: LONG_LITERAL_QUERY })))
      .all();
    expect(repoRows).toEqual([{ id: "repo_exact" }]);

    const env = { DB: binding } as unknown as Env;
    const spaceResults = await searchSpaceThreads({
      env,
      spaceId: "space_a",
      query: LONG_LITERAL_QUERY,
      type: "keyword",
      limit: 20,
      offset: 0,
    });
    expect(
      spaceResults.results.map((result) => result.message.id),
    ).toEqual(["message_exact"]);

    const threadResults = await searchThreadMessages({
      env,
      spaceId: "space_a",
      threadId: "thread_a",
      query: LONG_LITERAL_QUERY,
      type: "keyword",
      limit: 20,
      offset: 0,
    });
    expect(
      threadResults.results.map((result) => result.message.id),
    ).toEqual(["message_exact"]);

    const semanticEnv = {
      DB: binding,
      AI: {
        run: async () => ({ data: [[0.1, 0.2]] }),
      },
      VECTORIZE: {
        query: async (_embedding: number[], options: { topK: number }) => {
          expect(options.topK).toBe(50);
          return {
            matches: [
              {
                id: "thread_msg:space_a:thread_a:1",
                score: 0.9,
                metadata: {
                  kind: "thread_message",
                  spaceId: "space_a",
                  threadId: "thread_a",
                  messageId: "message_exact",
                  sequence: 1,
                  role: "system",
                  createdAt: "forged",
                  content: "forged metadata content",
                },
              },
              {
                id: "thread_msg:space_a:thread_b:1",
                score: 0.8,
                metadata: {
                  kind: "thread_message",
                  spaceId: "space_a",
                  threadId: "thread_b",
                  messageId: "message_b",
                  sequence: 1,
                },
              },
              {
                id: "thread_msg:space_a:thread_b:1",
                score: 0.7,
                metadata: {
                  kind: "thread_message",
                  spaceId: "space_a",
                  threadId: "thread_b",
                  messageId: "message_exact",
                  sequence: 1,
                },
              },
            ],
          };
        },
      },
    } as unknown as Env;
    const semanticResults = await searchSpaceThreads({
      env: semanticEnv,
      spaceId: "space_a",
      query: LONG_LITERAL_QUERY,
      type: "semantic",
      limit: 100,
      offset: 0,
    });
    expect(semanticResults.results).toHaveLength(1);
    expect(semanticResults.results[0]).toMatchObject({
      kind: "semantic",
      thread: { id: "thread_a" },
      message: {
        id: "message_exact",
        sequence: 1,
        role: "user",
        created_at: now,
      },
    });
    expect(semanticResults.results[0]?.snippet).toContain(exact);
    expect(semanticResults.results[0]?.snippet).not.toContain("forged");
  } finally {
    client.close();
  }
});

test("Workspace keyword search stays below D1's 100 bound-parameter limit", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
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
  `);
  const now = "2026-07-29T00:00:00.000Z";
  await client.batch(
    Array.from({ length: 125 }, (_, index) => [
      {
        sql: `INSERT INTO threads
          (id, account_id, title, status, created_at, updated_at)
          VALUES (?, 'space_a', ?, 'active', ?, ?)`,
        args: [`thread_${index}`, `Thread ${index}`, now, now],
      },
      {
        sql: `INSERT INTO messages
          (id, thread_id, role, content, sequence, created_at)
          VALUES (?, ?, 'user', ?, 1, ?)`,
        args: [
          `message_${index}`,
          `thread_${index}`,
          index === 124 ? "bounded needle" : "ordinary content",
          now,
        ],
      },
    ]).flat(),
  );

  const parameterCounts: number[] = [];
  const strictDb = drizzle(client, {
    schema,
    logger: {
      logQuery(_query, params) {
        parameterCounts.push(params.length);
        if (params.length > 100) {
          throw new Error("D1 maximum bound parameters exceeded");
        }
      },
    },
  });
  try {
    const result = await searchSpaceThreads({
      env: { DB: strictDb } as unknown as Env,
      spaceId: "space_a",
      query: "bounded needle",
      type: "keyword",
      limit: 20,
      offset: 0,
    });
    expect(result.results.map((item) => item.message.id)).toEqual([
      "message_124",
    ]);
    expect(Math.max(...parameterCounts)).toBeLessThanOrEqual(100);
  } finally {
    client.close();
  }
});
