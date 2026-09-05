import { expect, test } from "bun:test";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
  SqlTransactionSessionBinding,
} from "../../shared/types/bindings.ts";
import { executeAtomicStatements } from "./client.ts";

const atomicProbe = sqliteTable("atomic_probe", {
  id: integer("id").primaryKey(),
  value: text("value").notNull(),
});

function result<T>(): SqlResultBinding<T> {
  return { results: [], success: true, meta: { changes: 1 } };
}

function prepared(
  query: string,
  onRun?: (query: string, params: readonly unknown[]) => void,
  params: readonly unknown[] = [],
): SqlPreparedStatementBinding {
  async function raw<T = unknown[]>(options: {
    columnNames: true;
  }): Promise<[string[], ...T[]]>;
  async function raw<T = unknown[]>(options?: {
    columnNames?: false;
  }): Promise<T[]>;
  async function raw<T = unknown[]>(options?: {
    columnNames?: boolean;
  }): Promise<T[] | [string[], ...T[]]> {
    return options?.columnNames ? [[]] : [];
  }

  return {
    bind(...values: unknown[]) {
      return prepared(query, onRun, values);
    },
    async first<T>() {
      onRun?.(query, params);
      return null as T | null;
    },
    async run<T>() {
      onRun?.(query, params);
      return result<T>();
    },
    async all<T>() {
      onRun?.(query, params);
      return result<T>();
    },
    raw,
  };
}

function unsupportedNativeMethods(): Pick<
  SqlDatabaseBinding,
  "exec" | "withSession" | "dump"
> {
  return {
    async exec() {
      throw new Error("unexpected exec");
    },
    withSession() {
      throw new Error("unexpected session");
    },
    async dump() {
      throw new Error("unexpected dump");
    },
  };
}

test("atomic statements use one native D1 batch when no callback transaction exists", async () => {
  const batches: SqlPreparedStatementBinding[][] = [];
  const binding: SqlDatabaseBinding = {
    prepare(query) {
      return prepared(query);
    },
    async batch<T>(statements: SqlPreparedStatementBinding[]) {
      batches.push(statements);
      return statements.map(() => result<T>());
    },
    ...unsupportedNativeMethods(),
  };

  await executeAtomicStatements(binding, (db) => [
    db.delete(atomicProbe),
    db.insert(atomicProbe).values({ id: 1, value: "native-batch" }),
  ]);

  expect(batches).toHaveLength(1);
  expect(batches[0]).toHaveLength(2);
});

test("atomic statements execute on the handed transaction session when available", async () => {
  const transactionRuns: Array<{
    query: string;
    params: readonly unknown[];
  }> = [];
  let transactionCalls = 0;
  let outerBatchCalls = 0;
  const transactionSession: SqlTransactionSessionBinding = {
    prepare(query) {
      return prepared(query, (executed, params) => {
        transactionRuns.push({ query: executed, params });
      });
    },
    async batch<T>(statements: SqlPreparedStatementBinding[]) {
      return statements.map(() => result<T>());
    },
    async exec() {
      throw new Error("unexpected transaction exec");
    },
  };
  const binding: SqlDatabaseBinding = {
    prepare() {
      throw new Error("outer prepare must not execute inside withTransaction");
    },
    async batch<T>() {
      outerBatchCalls += 1;
      return [] as SqlResultBinding<T>[];
    },
    async withTransaction(callback) {
      transactionCalls += 1;
      return await callback(transactionSession);
    },
    ...unsupportedNativeMethods(),
  };

  await executeAtomicStatements(binding, (db) => [
    db.delete(atomicProbe),
    db.insert(atomicProbe).values({ id: 2, value: "explicit-tx" }),
  ]);

  expect(transactionCalls).toBe(1);
  expect(outerBatchCalls).toBe(0);
  expect(transactionRuns).toHaveLength(2);
  expect(transactionRuns[1]?.params).toEqual([2, "explicit-tx"]);
});
