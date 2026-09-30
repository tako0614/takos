import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openSqliteSqlDatabase,
  type ServerSqlDatabase,
} from "../persistent-d1.ts";

let directory: string;
const databases: ServerSqlDatabase[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "takos-persistent-d1-batch-"));
});

afterEach(async () => {
  for (const database of databases.splice(0).reverse()) {
    database.close();
  }
  await rm(directory, { force: true, recursive: true });
});

async function openDatabase(name: string): Promise<ServerSqlDatabase> {
  const database = await openSqliteSqlDatabase(
    join(directory, `${name}.sqlite`),
  );
  databases.push(database);
  await database.exec(
    'CREATE TABLE "batch_probe" ("id" TEXT PRIMARY KEY, "value" TEXT NOT NULL)',
  );
  return database;
}

async function readProbeRows(
  database: ServerSqlDatabase,
): Promise<Array<{ id: string; value: string }>> {
  const result = await database.prepare(
    'SELECT "id", "value" FROM "batch_probe" ORDER BY "id"',
  ).all<{ id: string; value: string }>();
  return result.results;
}

test("file-backed SQLite runs bound batch statements under one serialization gate", async () => {
  const database = await openDatabase("control");
  const batch = database.batch([
    database.prepare(
      'INSERT INTO "batch_probe" ("id", "value") VALUES (?, ?)',
    ).bind("first", "one"),
    database.prepare(
      'INSERT INTO "batch_probe" ("id", "value") VALUES (?, ?)',
    ).bind("second", "two"),
  ]);
  const observedCount = database.prepare(
    'SELECT COUNT(*) AS "count" FROM "batch_probe"',
  ).first<number>("count");

  const [results, count] = await Promise.all([batch, observedCount]);

  expect(results).toHaveLength(2);
  expect(count).toBe(2);
  expect(await readProbeRows(database)).toEqual([
    { id: "first", value: "one" },
    { id: "second", value: "two" },
  ]);
});

test("file-backed SQLite rejects a foreign statement before mutating either database", async () => {
  const database = await openDatabase("control");
  const foreignDatabase = await openDatabase("foreign");
  const ownedStatement = database.prepare(
    'INSERT INTO "batch_probe" ("id", "value") VALUES (?, ?)',
  ).bind("owned", "must-not-run");
  const foreignStatement = foreignDatabase.prepare(
    'INSERT INTO "batch_probe" ("id", "value") VALUES (?, ?)',
  ).bind("foreign", "must-not-run");

  await expect(
    database.batch([ownedStatement, foreignStatement]),
  ).rejects.toThrow("sqlite_batch_statement_mismatch");

  expect(await readProbeRows(database)).toEqual([]);
  expect(await readProbeRows(foreignDatabase)).toEqual([]);
  await database.batch([
    database.prepare(
      'INSERT INTO "batch_probe" ("id", "value") VALUES (?, ?)',
    ).bind("after", "usable"),
  ]);
  expect(await readProbeRows(database)).toEqual([
    { id: "after", value: "usable" },
  ]);
});

test("file-backed SQLite rolls back a mid-batch failure and remains usable", async () => {
  const database = await openDatabase("control");

  await expect(database.batch([
    database.prepare(
      'INSERT INTO "batch_probe" ("id", "value") VALUES (?, ?)',
    ).bind("duplicate", "first"),
    database.prepare(
      'INSERT INTO "batch_probe" ("id", "value") VALUES (?, ?)',
    ).bind("duplicate", "second"),
  ])).rejects.toThrow();

  expect(await readProbeRows(database)).toEqual([]);
  await database.prepare(
    'INSERT INTO "batch_probe" ("id", "value") VALUES (?, ?)',
  ).bind("after", "usable").run();
  expect(await readProbeRows(database)).toEqual([
    { id: "after", value: "usable" },
  ]);
});

test("file-backed SQLite recovers after a deferred constraint fails at batch commit", async () => {
  const database = await openDatabase("control");
  await database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE "batch_parent" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "batch_child" (
      "id" TEXT PRIMARY KEY,
      "parent_id" TEXT NOT NULL,
      FOREIGN KEY ("parent_id") REFERENCES "batch_parent" ("id")
        DEFERRABLE INITIALLY DEFERRED
    );
  `);

  await expect(database.batch([
    database.prepare(
      'INSERT INTO "batch_child" ("id", "parent_id") VALUES (?, ?)',
    ).bind("child", "missing-parent"),
  ])).rejects.toThrow();

  await database.prepare(
    'INSERT INTO "batch_parent" ("id") VALUES (?)',
  ).bind("missing-parent").run();
  const children = await database.prepare(
    'SELECT "id" FROM "batch_child"',
  ).all<{ id: string }>();
  const parents = await database.prepare(
    'SELECT "id" FROM "batch_parent"',
  ).all<{ id: string }>();
  expect(children.results).toEqual([]);
  expect(parents.results).toEqual([{ id: "missing-parent" }]);
});
