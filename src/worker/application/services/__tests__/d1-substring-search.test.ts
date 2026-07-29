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
  } finally {
    client.close();
  }
});
