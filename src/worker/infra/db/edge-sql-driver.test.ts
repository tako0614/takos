import { expect, test } from "bun:test";
import {
  Database as BunSqliteDatabase,
  type SQLQueryBindings,
} from "bun:sqlite";
import { eq, relations, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type {
  EdgeSqlBinding,
  EdgeSqlResult,
  EdgeSqlStatement,
  EdgeSqlValue,
} from "../../shared/types/bindings.ts";
import { drizzleEdgeSql } from "./edge-sql-driver.ts";

const parents = sqliteTable("edge_sql_parents", {
  id: integer("id").notNull(),
  name: text("name").notNull(),
});

const children = sqliteTable("edge_sql_children", {
  id: integer("id").notNull(),
  parentId: integer("parent_id").notNull(),
  name: text("name").notNull(),
});

const parentRelations = relations(parents, ({ many }) => ({
  children: many(children),
}));

const childRelations = relations(children, ({ one }) => ({
  parent: one(parents, {
    fields: [children.parentId],
    references: [parents.id],
  }),
}));

function projectionAliases(statement: string): string[] {
  return [...statement.matchAll(/ as "(__takos_edge_sql_v1_c[0-9]+x)"/g)]
    .map((match) => match[1]!);
}

function rejectingBinding(overrides: Partial<EdgeSqlBinding>): EdgeSqlBinding {
  return {
    async execute(_sql: string, _params?: readonly EdgeSqlValue[]) {
      throw new Error("unexpected execute");
    },
    async query(_sql: string, _params?: readonly EdgeSqlValue[]) {
      throw new Error("unexpected query");
    },
    async transaction(_statements: readonly EdgeSqlStatement[]) {
      throw new Error("unexpected transaction");
    },
    ...overrides,
  };
}

function sqliteFixtureBinding(sqlite: BunSqliteDatabase): EdgeSqlBinding {
  const decodeParam = (value: EdgeSqlValue): SQLQueryBindings => {
    if (typeof value !== "object" || value === null) return value;
    const binary = atob(value.data);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  };
  const encodeValue = (value: unknown): EdgeSqlValue => {
    if (!(value instanceof Uint8Array)) return value as EdgeSqlValue;
    let binary = "";
    for (const byte of value) binary += String.fromCharCode(byte);
    return { encoding: "base64", data: btoa(binary) };
  };
  const totalChanges = (): number =>
    sqlite.query<{ total: number }, []>(
      "select total_changes() as total",
    ).get()!.total;
  const run = (
    statement: string,
    params: readonly EdgeSqlValue[] | undefined,
  ): EdgeSqlResult => {
    const before = totalChanges();
    const prepared = sqlite.query<Record<string, unknown>, SQLQueryBindings[]>(
      statement,
    );
    const rows = prepared.all(...(params ?? []).map(decodeParam));
    return {
      rows: rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).reverse().map(([key, value]) => [
            key,
            encodeValue(value),
          ]),
        )
      ),
      rowsWritten: totalChanges() - before,
    };
  };

  return {
    async execute(statement, params) {
      return run(statement, params);
    },
    async query(statement, params) {
      sqlite.run("savepoint edge_sql_query");
      try {
        const result = run(statement, params);
        sqlite.run("rollback to edge_sql_query");
        sqlite.run("release edge_sql_query");
        return { rows: result.rows, rowsWritten: 0 };
      } catch (error) {
        sqlite.run("rollback to edge_sql_query");
        sqlite.run("release edge_sql_query");
        throw error;
      }
    },
    async transaction(statements) {
      sqlite.run("begin immediate");
      try {
        const results = statements.map(({ sql: statement, params }) =>
          run(statement, params)
        );
        sqlite.run("commit");
        return { results };
      } catch (error) {
        sqlite.run("rollback");
        throw error;
      }
    },
  };
}

test("joined duplicate column names stay distinct under reordered host keys", async () => {
  const binding = rejectingBinding({
    async query(statement) {
      const aliases = projectionAliases(statement);
      expect(aliases).toHaveLength(4);
      expect(new Set(aliases).size).toBe(4);
      return {
        rows: [{
          [aliases[3]!]: "child",
          [aliases[2]!]: 22,
          [aliases[1]!]: "parent",
          [aliases[0]!]: 11,
        }],
        rowsWritten: 0,
      } satisfies EdgeSqlResult;
    },
  });
  const db = drizzleEdgeSql(binding);

  const result = await db
    .select({
      parentId: parents.id,
      parentName: parents.name,
      childId: children.id,
      childName: children.name,
    })
    .from(parents)
    .innerJoin(children, eq(children.parentId, parents.id));

  expect(result).toEqual([{
    parentId: 11,
    parentName: "parent",
    childId: 22,
    childName: "child",
  }]);
});

test("nullable joins retain Drizzle's nested null mapping", async () => {
  const binding = rejectingBinding({
    async query(statement) {
      const aliases = projectionAliases(statement);
      expect(aliases).toHaveLength(2);
      return {
        rows: [{ [aliases[1]!]: null, [aliases[0]!]: 11 }],
        rowsWritten: 0,
      };
    },
  });
  const db = drizzleEdgeSql(binding);

  const result = await db.select({
    parent: { id: parents.id },
    child: { id: children.id },
  }).from(parents).leftJoin(children, eq(children.parentId, parents.id));

  expect(result).toEqual([{ parent: { id: 11 }, child: null }]);
});

test("generated SQL executes through an edge.sql-shaped SQLite host", async () => {
  const sqlite = new BunSqliteDatabase(":memory:");
  try {
    sqlite.run(
      "create table edge_sql_parents (id integer not null, name text not null)",
    );
    sqlite.run(
      "create table edge_sql_children (id integer not null, parent_id integer not null, name text not null)",
    );
    sqlite.run(
      "insert into edge_sql_parents (id, name) values (11, 'parent')",
    );
    sqlite.run(
      "insert into edge_sql_children (id, parent_id, name) values (22, 11, 'child')",
    );
    const db = drizzleEdgeSql(sqliteFixtureBinding(sqlite), {
      schema: { parents, children, parentRelations, childRelations },
    });

    const joined = await db.select({
      parentId: parents.id,
      childId: children.id,
    }).from(parents).innerJoin(
      children,
      eq(children.parentId, parents.id),
    );
    expect(joined).toEqual([{ parentId: 11, childId: 22 }]);

    const relational = await db.query.parents.findMany({
      with: { children: true },
    });
    expect(relational).toEqual([{
      id: 11,
      name: "parent",
      children: [{ id: 22, parentId: 11, name: "child" }],
    }]);

    const inserted = await db.insert(parents).values({
      id: 33,
      name: "created",
    }).returning({ id: parents.id, name: parents.name });
    expect(inserted).toEqual([{ id: 33, name: "created" }]);

    const displayName = sql<string>`upper(${parents.name})`.as("display_name");
    const ordered = await db.select({ displayName }).from(parents).orderBy(
      ({ displayName: selected }) => selected,
    );
    expect(ordered).toEqual([
      { displayName: "CREATED" },
      { displayName: "PARENT" },
    ]);

    const updated = await db.update(parents).set({ name: "updated" }).where(
      eq(parents.id, 33),
    ).returning({ id: parents.id, name: parents.name });
    expect(updated).toEqual([{ id: 33, name: "updated" }]);

    const deleted = await db.delete(parents).where(eq(parents.id, 33))
      .returning({ id: parents.id, name: parents.name });
    expect(deleted).toEqual([{ id: 33, name: "updated" }]);
  } finally {
    sqlite.close();
  }
});

test("explicit projection aliases remain valid in orderBy callbacks", async () => {
  const binding = rejectingBinding({
    async query(statement) {
      const aliases = projectionAliases(statement);
      expect(aliases).toHaveLength(1);
      expect(statement).toContain(`order by "${aliases[0]}"`);
      expect(statement).not.toContain("order by \"display_name\"");
      return {
        rows: [{ [aliases[0]!]: "PARENT" }],
        rowsWritten: 0,
      };
    },
  });
  const db = drizzleEdgeSql(binding);
  const displayName = sql<string>`upper(${parents.name})`.as("display_name");

  const result = await db
    .select({ displayName })
    .from(parents)
    .orderBy(({ displayName: selected }) => selected);

  expect(result).toEqual([{ displayName: "PARENT" }]);
});

test("explicit projection aliases remain valid in grouping callbacks", async () => {
  const binding = rejectingBinding({
    async query(statement, params) {
      const [alias] = projectionAliases(statement);
      expect(statement).toContain(`group by "${alias}"`);
      expect(statement).toContain(
        'having upper("edge_sql_parents"."name") = ?',
      );
      expect(params).toEqual(["PARENT"]);
      return {
        rows: [{ [alias!]: "PARENT" }],
        rowsWritten: 0,
      };
    },
  });
  const db = drizzleEdgeSql(binding);
  const displayName = sql<string>`upper(${parents.name})`.as("display_name");

  const result = await db
    .select({ displayName })
    .from(parents)
    .groupBy(({ displayName: selected }) => selected)
    .having(({ displayName: selected }) => eq(selected, "PARENT"));

  expect(result).toEqual([{ displayName: "PARENT" }]);
});

test("execution aliases do not change subquery column names", async () => {
  const binding = rejectingBinding({
    async query(statement) {
      const aliases = projectionAliases(statement);
      expect(aliases).toHaveLength(2);
      expect(statement).toContain('as "display_name" from "edge_sql_parents"');
      expect(statement).toContain(
        `"display_name" as "${aliases[1]}" from (select`,
      );
      return {
        rows: [{ [aliases[1]!]: "PARENT", [aliases[0]!]: 11 }],
        rowsWritten: 0,
      };
    },
  });
  const db = drizzleEdgeSql(binding);
  const parentSubquery = db
    .select({
      id: parents.id,
      displayName: sql<string>`upper(${parents.name})`.as("display_name"),
    })
    .from(parents)
    .as("parent_sq");

  const result = await db
    .select({
      id: parentSubquery.id,
      displayName: parentSubquery.displayName,
    })
    .from(parentSubquery);

  expect(result).toEqual([{ id: 11, displayName: "PARENT" }]);
});

test("execution aliases do not change CTE column names", async () => {
  const binding = rejectingBinding({
    async query(statement) {
      const aliases = projectionAliases(statement);
      expect(aliases).toHaveLength(2);
      expect(statement).toContain(
        'with "parent_cte" as (select "id", upper("name") as "display_name"',
      );
      expect(statement).toContain(
        `select "id" as "${aliases[0]}", "display_name" as "${aliases[1]}" from "parent_cte"`,
      );
      return {
        rows: [{ [aliases[1]!]: "PARENT", [aliases[0]!]: 11 }],
        rowsWritten: 0,
      };
    },
  });
  const db = drizzleEdgeSql(binding);
  const parentCte = db.$with("parent_cte").as(
    db.select({
      id: parents.id,
      displayName: sql<string>`upper(${parents.name})`.as("display_name"),
    }).from(parents),
  );

  const result = await db.with(parentCte).select({
    id: parentCte.id,
    displayName: parentCte.displayName,
  }).from(parentCte);

  expect(result).toEqual([{ id: 11, displayName: "PARENT" }]);
});

test("mutation RETURNING uses execute and positional aliases", async () => {
  const calls: string[] = [];
  const binding = rejectingBinding({
    async execute(statement, params) {
      calls.push("execute");
      expect(params).toEqual([33, "created"]);
      const aliases = projectionAliases(statement);
      expect(aliases).toHaveLength(2);
      return {
        rows: [{ [aliases[1]!]: "created", [aliases[0]!]: 33 }],
        rowsWritten: 1,
      };
    },
  });
  const db = drizzleEdgeSql(binding);

  const result = await db
    .insert(parents)
    .values({ id: 33, name: "created" })
    .returning({ id: parents.id, name: parents.name });

  expect(result).toEqual([{ id: 33, name: "created" }]);
  expect(calls).toEqual(["execute"]);
});

test("relational custom mappers receive projection-ordered values", async () => {
  const binding = rejectingBinding({
    async query(statement) {
      const aliases = projectionAliases(statement);
      expect(aliases).toHaveLength(3);
      return {
        rows: [{
          [aliases[2]!]: JSON.stringify([[22, 11, "child"]]),
          [aliases[0]!]: 11,
          [aliases[1]!]: "parent",
        }],
        rowsWritten: 0,
      };
    },
  });
  const db = drizzleEdgeSql(binding, {
    schema: { parents, children, parentRelations, childRelations },
  });

  const result = await db.query.parents.findMany({
    with: { children: true },
  });

  expect(result).toEqual([{
    id: 11,
    name: "parent",
    children: [{ id: 22, parentId: 11, name: "child" }],
  }]);
});

test("structured reads reject a non-rollback query result", async () => {
  const binding = rejectingBinding({
    async query(statement) {
      const [alias] = projectionAliases(statement);
      return {
        rows: [{ [alias!]: 11 }],
        rowsWritten: 1,
      };
    },
  });
  const db = drizzleEdgeSql(binding);

  let failure: unknown;
  try {
    await db.select({ id: parents.id }).from(parents).execute();
  } catch (error) {
    failure = error;
  }
  const cause = (failure as { cause?: Error } | undefined)?.cause;
  expect(cause?.name).toBe("sql_error");
  expect(cause?.message).toContain(
    "rollback-only query returned rowsWritten 1",
  );
});

test("raw positional access refuses before calling the host", async () => {
  const db = drizzleEdgeSql(rejectingBinding({}));

  await expect(db.values(sql.raw("select 1")).execute()).rejects.toThrow(
    "positional results require Drizzle projection metadata",
  );
});

test("raw named all and get preserve records without positional inference", async () => {
  const calls: string[] = [];
  const binding = rejectingBinding({
    async execute(statement) {
      calls.push(statement);
      return {
        rows: [{ label: "raw", "1": 9 }],
        rowsWritten: 0,
      };
    },
  });
  const db = drizzleEdgeSql(binding);

  const all = await db.all<{ "1": number; label: string }>(
    sql.raw("select 9 as '1', 'raw' as label"),
  );
  const first = await db.get<{ "1": number; label: string }>(
    sql.raw("select 9 as '1', 'raw' as label"),
  );

  expect(all).toEqual([{ "1": 9, label: "raw" }]);
  expect(first).toEqual({ "1": 9, label: "raw" });
  expect(calls).toHaveLength(2);
});

test("raw run decodes canonical bytes exactly once", async () => {
  const db = drizzleEdgeSql(rejectingBinding({
    async execute() {
      return {
        rows: [{ payload: { encoding: "base64", data: "AAECg/8=" } }],
        rowsWritten: 0,
      };
    },
  }));

  const result = await db.run(sql.raw("select payload from blobs"));
  const row = result.results[0] as { payload: Uint8Array };

  expect(row.payload).toBeInstanceOf(Uint8Array);
  expect([...row.payload]).toEqual([
    0,
    1,
    2,
    131,
    255,
  ]);
});

test("callback transactions refuse without invoking the callback", async () => {
  const db = drizzleEdgeSql(rejectingBinding({}));
  let invoked = false;

  await expect(db.transaction(async () => {
    invoked = true;
    return "unreachable";
  })).rejects.toThrow(
    "callback transactions are not expressible; use db.batch()",
  );
  expect(invoked).toBe(false);
});

test("batch maps one published transaction envelope in statement order", async () => {
  const transactions: Array<readonly EdgeSqlStatement[]> = [];
  const binding = rejectingBinding({
    async transaction(statements) {
      transactions.push(statements);
      const firstAliases = projectionAliases(statements[0]!.sql);
      const secondAliases = projectionAliases(statements[1]!.sql);
      expect(firstAliases).toHaveLength(1);
      expect(secondAliases).toHaveLength(1);
      return {
        results: [
          {
            rows: [{ [firstAliases[0]!]: 44 }],
            rowsWritten: 1,
          },
          {
            rows: [{ [secondAliases[0]!]: "selected" }],
            rowsWritten: 0,
          },
        ],
      };
    },
  });
  const db = drizzleEdgeSql(binding);

  const result = await db.batch([
    db.insert(parents).values({ id: 44, name: "batched" }).returning({
      id: parents.id,
    }),
    db.select({ name: parents.name }).from(parents),
  ]);

  expect(transactions).toHaveLength(1);
  expect(result).toEqual([
    [{ id: 44 }],
    [{ name: "selected" }],
  ]);
});

test("batch refuses more than the published 100-statement limit", async () => {
  let invoked = false;
  const db = drizzleEdgeSql(rejectingBinding({
    async transaction() {
      invoked = true;
      return { results: [] };
    },
  }));
  const queries = Array.from(
    { length: 101 },
    () => db.select({ id: parents.id }).from(parents),
  );

  await expect(db.batch(queries as never)).rejects.toThrow(
    "101 statements exceed the edge.sql limit of 100",
  );
  expect(invoked).toBe(false);
});
