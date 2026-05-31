// Bun migration shim: node:sqlite -> bun:sqlite.
//
// Bun 1.3.14 does not implement Node's experimental built-in `node:sqlite`
// (the `DatabaseSync` API used by src/git.ts and src/index_test.ts). Bun
// instead ships `bun:sqlite`, which provides an API-compatible synchronous
// SQLite binding. This shim re-exports a `DatabaseSync` class backed by
// `bun:sqlite` so the existing `import { DatabaseSync } from "node:sqlite"`
// call sites run unchanged under bun. It is wired in via tsconfig "paths"
// ("node:sqlite" -> this file), the same mechanism the @std/* shims use.
//
// Surface required by this repo (verified by grep over src/):
//   new DatabaseSync(path)         -> open a database file (or :memory:)
//   db.close()
//   db.exec(sql)                   -> run statements with no params (DDL, tx)
//   const stmt = db.prepare(sql)
//   stmt.get(...params)            -> first row as object, or undefined on miss
//   stmt.run(...params)            -> execute write
//   stmt.all(...params)            -> all rows as objects
//
// node:sqlite `.get()` returns `undefined` when there is no row; bun:sqlite's
// `Statement.get()` can return `null`. We normalize `null` -> `undefined` so
// callers like `if (hasMigration.get(version))` and `.get() as { count }`
// behave identically to node:sqlite.

type RuntimeStatement = {
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
  iterate?: (...params: unknown[]) => IterableIterator<unknown>;
};

type RuntimeDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => RuntimeStatement;
  close: () => void;
};

type RuntimeDatabaseConstructor = new (path: string) => RuntimeDatabase;

const runtimeSqlite = typeof (globalThis as { Bun?: unknown }).Bun === "object"
  ? (await import("bun:sqlite") as {
    Database: RuntimeDatabaseConstructor;
  }).Database
  : (await import("node:sqlite") as {
    DatabaseSync: RuntimeDatabaseConstructor;
  }).DatabaseSync;

class StatementSync {
  #stmt: RuntimeStatement;
  constructor(stmt: RuntimeStatement) {
    this.#stmt = stmt;
  }

  get(...params: unknown[]): unknown {
    const row = this.#stmt.get(...params);
    return row == null ? undefined : row;
  }

  run(...params: unknown[]): unknown {
    return this.#stmt.run(...params);
  }

  all(...params: unknown[]): unknown[] {
    return this.#stmt.all(...params) ?? [];
  }

  iterate(...params: unknown[]): IterableIterator<unknown> {
    // bun:sqlite exposes iteration via .iterate when available.
    const it = this.#stmt.iterate;
    if (typeof it === "function") return it.call(this.#stmt, ...params);
    return this.all(...params)[Symbol.iterator]();
  }
}

export class DatabaseSync {
  #db: RuntimeDatabase;
  constructor(path: string) {
    this.#db = new runtimeSqlite(path);
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(this.#db.prepare(sql));
  }

  close(): void {
    this.#db.close();
  }
}

export { StatementSync };
export default { DatabaseSync, StatementSync };
