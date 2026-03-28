/**
 * Database resolver — selects D1/SQLite/Postgres based on environment.
 */
import path from 'node:path';
import {
  createInMemoryD1Database,
} from '../../local-platform/in-memory-bindings.ts';
import {
  createPostgresD1Database,
  createSqliteD1Database,
} from '../../local-platform/persistent-bindings.ts';

export async function resolveDatabase(postgresUrl: string | null, dataDir: string | null, migrationsDir: string) {
  if (postgresUrl) return createPostgresD1Database(postgresUrl);
  if (dataDir) return createSqliteD1Database(path.join(dataDir, 'db', 'control.sqlite'), migrationsDir);
  return createInMemoryD1Database();
}
