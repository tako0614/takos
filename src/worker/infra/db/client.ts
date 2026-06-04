/**
 * Drizzle ORM Database Client
 *
 * Drizzle ORM client for the SQL binding shape.
 * Drizzle stores DateTime as text() and returns strings directly - no normalization needed.
 */

import { drizzle } from "drizzle-orm/d1";
import type { SqlDatabaseBinding } from "../../shared/types/bindings.ts";
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

  const client = drizzle(db, { schema });
  clientCache.set(db, client);
  return client;
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
