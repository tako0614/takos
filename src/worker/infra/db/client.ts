/**
 * Drizzle ORM Database Client
 *
 * Drizzle ORM client for the SQL binding shape.
 * Drizzle stores DateTime as text() and returns strings directly - no normalization needed.
 */

import type { BatchItem } from "drizzle-orm/batch";
import { type AnyD1Database, drizzle } from "drizzle-orm/d1";
import { getEdgeSqlSourceBinding } from "../../platform/adapters/edge-sql.ts";
import type {
  SqlDatabaseBinding,
  SqlTransactionSessionBinding,
} from "../../shared/types/bindings.ts";
import { drizzleEdgeSql } from "./edge-sql-driver.ts";
import * as schema from "./schema.ts";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Either a raw platform SQL binding or a drizzle-wrapped `Database`. Functions
 * that immediately pipe their `db` parameter through `getDb()` should accept
 * this union — `getDb` already handles both shapes via runtime detection
 * (see `isDrizzleLikeDb`), so widening the signature matches reality and
 * lets call sites pass either form without a cast.
 */
export type SqlDatabaseLike = SqlDatabaseBinding | Database;

type AtomicDrizzleStatement = BatchItem<"sqlite"> & {
  execute(): Promise<unknown>;
};

type AtomicDrizzleStatements = readonly AtomicDrizzleStatement[];
type DatabaseResolver = (binding: SqlDatabaseBinding) => Database;

function isDrizzleLikeDb(value: unknown): value is Database {
  return typeof value === "object" &&
    value !== null &&
    "select" in value &&
    "insert" in value &&
    "update" in value &&
    "delete" in value;
}

// Cache Drizzle clients per SQL binding. Platform adapters commonly provide a
// fresh binding object per request, so WeakMap naturally scopes the client
// without cross-request contamination.
const clientCache = new WeakMap<SqlDatabaseBinding, Database>();

export function getDb(db: SqlDatabaseBinding | Database): Database {
  if (isDrizzleLikeDb(db)) {
    return db;
  }

  const cached = clientCache.get(db);
  if (cached) return cached;

  const edgeSql = getEdgeSqlSourceBinding(db);
  const client = (edgeSql
    ? drizzleEdgeSql(edgeSql, { schema })
    : drizzle(db, { schema })) as Database;
  clientCache.set(db, client);
  return client;
}

function getTransactionDb(tx: SqlTransactionSessionBinding): Database {
  // Drizzle's D1 declaration names the complete provider binding even though
  // sequential query execution needs only prepare/bind/run. The canonical
  // transaction session deliberately exposes that smaller, dedicated-client
  // surface; this bridge stays private and the returned client never escapes
  // the withTransaction callback.
  return drizzle(tx as unknown as AnyD1Database, { schema }) as Database;
}

/**
 * Execute one statically built group of Drizzle statements atomically.
 *
 * Stateful adapters expose a dedicated callback transaction, so every query
 * is built against and executed through that handed session. Stateless D1 and
 * edge.sql bindings instead receive the complete group in one native batch.
 */
export async function executeAtomicStatements(
  binding: SqlDatabaseBinding,
  build: (db: Database) => AtomicDrizzleStatements,
  resolveBatchDb: DatabaseResolver = getDb,
): Promise<void> {
  if (typeof binding.withTransaction === "function") {
    await binding.withTransaction(async (tx) => {
      const statements = build(getTransactionDb(tx));
      if (statements.length === 0) {
        throw new TypeError("an atomic statement group cannot be empty");
      }
      for (const statement of statements) {
        await statement.execute();
      }
    });
    return;
  }

  const batchDb = resolveBatchDb(binding);
  const [first, ...rest] = build(batchDb);
  if (!first) {
    throw new TypeError("an atomic statement group cannot be empty");
  }
  await batchDb.batch([first, ...rest]);
}

/**
 * Single home for the "already-drizzle-ish or raw-binding" guard that several
 * services used to copy-paste inline: if `db` already exposes a `select`
 * method it is treated as a usable `Database` and returned as-is, otherwise it
 * is wrapped via {@link getDb}. This is intentionally a looser check than
 * `getDb`'s internal `isDrizzleLikeDb` (which also requires insert/update/
 * delete): callers and tests inject partial drizzle-shaped doubles that only
 * implement `select`, and the folded-out copies all keyed off `select` alone.
 * Import this instead of re-deriving the guard.
 */
export function resolveDb(db: SqlDatabaseBinding | Database): Database {
  if (db && typeof (db as { select?: unknown }).select === "function") {
    return db as Database;
  }
  return getDb(db);
}
