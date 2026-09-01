import { expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";

import { createPreparedStatement } from "../../../local-platform/d1-prepared-statement.ts";
import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
} from "../../../shared/types/bindings.ts";
import type { SpaceFile } from "../../../shared/types/index.ts";
import { extractAndCreateEdges } from "./graph.ts";

type TracedDatabase = {
  client: Client;
  db: SqlDatabaseBinding;
  filePathLookupQueries: string[];
};

async function createTracedDatabase(): Promise<TracedDatabase> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE files (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      path TEXT NOT NULL
    );
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      ref_id TEXT NOT NULL
    );
    CREATE TABLE edges (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const filePathLookupQueries: string[] = [];
  const prepare = (query: string): SqlPreparedStatementBinding => {
    if (/^\s*select\b/i.test(query) && /"files"/i.test(query)) {
      filePathLookupQueries.push(query);
    }
    return createPreparedStatement(client, query);
  };
  async function batch<T = Record<string, unknown>>(
    statements: SqlPreparedStatementBinding[],
  ) {
    return Promise.all(statements.map((statement) => statement.run<T>()));
  }

  const db = {
    prepare,
    batch,
    async exec(_query: string) {
      return { count: 0, duration: 0 };
    },
    withSession() {
      return { prepare, batch, getBookmark: () => null };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as SqlDatabaseBinding;

  return { client, db, filePathLookupQueries };
}

function sourceFile(spaceId: string): SpaceFile {
  return {
    id: "source-file",
    space_id: spaceId,
    path: "src/main.ts",
    sha256: null,
    mime_type: "text/typescript",
    size: 0,
    origin: "user",
    kind: "source",
    visibility: "private",
    indexed_at: null,
    created_at: "2026-08-30T00:00:00.000Z",
    updated_at: "2026-08-30T00:00:00.000Z",
  };
}

test("extractAndCreateEdges preserves candidate priority with one file lookup", async () => {
  const { client, db, filePathLookupQueries } = await createTracedDatabase();
  try {
    await client.executeMultiple(`
      INSERT INTO files (id, account_id, path) VALUES
        ('file-lib-ts', 'space-1', 'src/lib.ts'),
        ('file-lib-js', 'space-1', 'src/lib.js');
      INSERT INTO nodes (id, account_id, type, ref_id) VALUES
        ('node-lib-ts', 'space-1', 'file', 'file-lib-ts'),
        ('node-lib-js', 'space-1', 'file', 'file-lib-js');
    `);

    await extractAndCreateEdges(
      db,
      "space-1",
      sourceFile("space-1"),
      'import { lib } from "./lib";',
      "node-source",
    );

    expect(filePathLookupQueries).toHaveLength(1);
    const result = await client.execute(
      "SELECT source_id, target_id, type FROM edges",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      source_id: "node-source",
      target_id: "node-lib-ts",
      type: "imports",
    });
  } finally {
    client.close();
  }
});

test("extractAndCreateEdges performs one file lookup when no candidate matches", async () => {
  const { client, db, filePathLookupQueries } = await createTracedDatabase();
  try {
    await extractAndCreateEdges(
      db,
      "space-1",
      sourceFile("space-1"),
      'import { missing } from "./missing";',
      "node-source",
    );

    expect(filePathLookupQueries).toHaveLength(1);
    const result = await client.execute("SELECT id FROM edges");
    expect(result.rows).toHaveLength(0);
  } finally {
    client.close();
  }
});

test("extractAndCreateEdges does not skip an existing candidate without a node", async () => {
  const { client, db, filePathLookupQueries } = await createTracedDatabase();
  try {
    await client.executeMultiple(`
      INSERT INTO files (id, account_id, path) VALUES
        ('file-lib-ts', 'space-1', 'src/lib.ts'),
        ('file-lib-js', 'space-1', 'src/lib.js');
      INSERT INTO nodes (id, account_id, type, ref_id) VALUES
        ('node-lib-js', 'space-1', 'file', 'file-lib-js');
    `);

    await extractAndCreateEdges(
      db,
      "space-1",
      sourceFile("space-1"),
      'import { lib } from "./lib";',
      "node-source",
    );

    expect(filePathLookupQueries).toHaveLength(1);
    const result = await client.execute("SELECT id FROM edges");
    expect(result.rows).toHaveLength(0);
  } finally {
    client.close();
  }
});
