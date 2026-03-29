/**
 * In-memory stub of Cloudflare D1 (SQLite-compatible edge database).
 *
 * Returns empty results for all queries. Useful as a no-op placeholder
 * during local development or in tests where database access is not
 * required.
 */
import type { D1Database } from '../shared/types/bindings.ts';
export declare function createInMemoryD1Database(): D1Database;
//# sourceMappingURL=in-memory-d1.d.ts.map