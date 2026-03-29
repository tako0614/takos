/**
 * Persistent local implementations of the Cloudflare D1 (SQLite-compatible edge database) interface.
 *
 * Provides two adapters for local/server use where a real D1 binding is
 * unavailable:
 *   - `createSqliteD1Database`   -- backed by a local SQLite file via libSQL
 *   - `createPostgresD1Database` -- backed by a PostgreSQL connection pool
 *
 * Both expose the same D1-compatible API (prepare / batch / exec / withSession)
 * so that the rest of the codebase can treat them identically to Cloudflare D1.
 */
import { type ServerD1Database } from './d1-shared.ts';
export { splitSqlStatements } from './d1-sql-rewrite.ts';
export type { ServerD1Database } from './d1-shared.ts';
export declare function createSqliteD1Database(dbPath: string, migrationsDir: string): Promise<ServerD1Database>;
export declare function createPostgresD1Database(connectionString: string): Promise<ServerD1Database>;
//# sourceMappingURL=persistent-d1.d.ts.map