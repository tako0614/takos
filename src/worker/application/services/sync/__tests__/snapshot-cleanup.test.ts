import { expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
} from "../../../../shared/types/bindings.ts";
import {
  createPreparedStatement,
  createSequentialBatch,
} from "../../../../local-platform/d1-prepared-statement.ts";
import {
  getReachableSnapshots,
  getReachableSnapshotsForHeads,
} from "../snapshot-cleanup.ts";

type SnapshotSeed = {
  id: string;
  parentIds?: string | null;
};

type Trace = {
  snapshotSelects: number;
};

async function createFixture(seeds: SnapshotSeed[]): Promise<{
  client: Client;
  db: SqlDatabaseBinding;
  trace: Trace;
}> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE snapshots (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      parent_ids TEXT,
      tree_key TEXT NOT NULL,
      message TEXT,
      author TEXT,
      status TEXT NOT NULL DEFAULT 'complete',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  for (const seed of seeds) {
    await client.execute({
      sql:
        "INSERT INTO snapshots (id, account_id, parent_ids, tree_key) VALUES (?, 'space-a', ?, ?)",
      args: [seed.id, seed.parentIds ?? null, `tree-${seed.id}`],
    });
  }

  const trace: Trace = { snapshotSelects: 0 };
  const runStatement = <T = Record<string, unknown>>(
    statement: SqlPreparedStatementBinding,
  ) =>
    statement.run<T>();
  const db = {
    prepare(query: string) {
      if (/from\s+"snapshots"/i.test(query)) {
        trace.snapshotSelects++;
      }
      return createPreparedStatement(client, query);
    },
    batch: createSequentialBatch(runStatement),
  } as SqlDatabaseBinding;

  return { client, db, trace };
}

function env(db: SqlDatabaseBinding) {
  return { DB: db } as never;
}

test("multi-head reachability reuses rows across a shared ancestor chain", async () => {
  const fixture = await createFixture([
    { id: "head-a", parentIds: JSON.stringify(["shared"]) },
    { id: "head-b", parentIds: JSON.stringify(["shared"]) },
    { id: "shared", parentIds: JSON.stringify(["root"]) },
    { id: "root", parentIds: "[]" },
  ]);

  try {
    const reachable = await getReachableSnapshotsForHeads(
      env(fixture.db),
      "space-a",
      ["head-a", "head-b"],
    );

    expect(reachable).toEqual(
      new Set(["head-a", "shared", "root", "head-b"]),
    );
    expect(fixture.trace.snapshotSelects).toBe(4);
  } finally {
    fixture.client.close();
  }
});

test("multi-head reachability caches duplicate and missing heads", async () => {
  const fixture = await createFixture([
    { id: "head", parentIds: JSON.stringify(["shared"]) },
    { id: "shared", parentIds: "[]" },
  ]);

  try {
    const reachable = await getReachableSnapshotsForHeads(
      env(fixture.db),
      "space-a",
      ["head", "head", "missing", "missing", ""],
    );

    expect(reachable).toEqual(new Set(["head", "shared"]));
    expect(fixture.trace.snapshotSelects).toBe(4);
  } finally {
    fixture.client.close();
  }
});

test("multi-head reachability replays an exact batch in SQL row order", async () => {
  const fixture = await createFixture([
    { id: "head-a", parentIds: JSON.stringify(["parent-z", "parent-a"]) },
    { id: "head-b", parentIds: JSON.stringify(["parent-z", "parent-a"]) },
    { id: "parent-a", parentIds: "[]" },
    { id: "parent-z", parentIds: "[]" },
  ]);

  try {
    const reachable = await getReachableSnapshotsForHeads(
      env(fixture.db),
      "space-a",
      ["head-a", "head-b"],
    );

    // SQLite returns this IN-list batch in primary-key order (a before z),
    // which differs from the parent ID order supplied by each head.
    expect([...reachable]).toEqual([
      "head-a",
      "parent-a",
      "parent-z",
      "head-b",
    ]);
    expect(fixture.trace.snapshotSelects).toBe(3);
  } finally {
    fixture.client.close();
  }
});

test("single-head reachability keeps malformed parents and missing rows safe", async () => {
  const fixture = await createFixture([
    { id: "head", parentIds: JSON.stringify(["malformed", "missing"]) },
    { id: "malformed", parentIds: "not-json" },
  ]);

  try {
    const reachable = await getReachableSnapshots(
      env(fixture.db),
      "space-a",
      "head",
    );

    expect(reachable).toEqual(new Set(["head", "malformed"]));
  } finally {
    fixture.client.close();
  }
});
