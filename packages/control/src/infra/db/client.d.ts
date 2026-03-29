/**
 * Drizzle ORM Database Client
 *
 * Drizzle ORM D1 client.
 * Drizzle stores DateTime as text() and returns strings directly - no normalization needed.
 */
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '../../shared/types/bindings.ts';
import * as schema from './schema';
export type Database = ReturnType<typeof drizzle<typeof schema>>;
export declare function getDb(db: D1Database): Database;
//# sourceMappingURL=client.d.ts.map