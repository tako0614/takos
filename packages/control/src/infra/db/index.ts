/**
 * Drizzle ORM Database Client
 *
 * Replaces the Prisma 3-layer DateTime workaround with direct Drizzle D1 access.
 * Drizzle stores DateTime as text() and returns strings directly - no normalization needed.
 */

import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '../../shared/types/bindings.ts';
import * as schema from './schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

// Cache Drizzle client per D1Database binding. Each Cloudflare Workers request
// receives a fresh D1Database object, so WeakMap naturally scopes the client
// to a single request lifetime without cross-request contamination. Within
// a request the same binding is reused, avoiding repeated drizzle()
// construction (hundreds of calls per request).
const clientCache = new WeakMap<D1Database, Database>();

export function getDb(db: D1Database): Database {
  const cached = clientCache.get(db);
  if (cached) return cached;

  const client = drizzle(db, { schema });
  clientCache.set(db, client);
  return client;
}

export * from './schema';
