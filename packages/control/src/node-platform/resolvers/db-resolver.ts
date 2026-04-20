/**
 * Database resolver — selects D1/SQLite/Postgres based on environment.
 */
import path from "node:path";
import { createResolver } from "./resolver-factory.ts";
import {
  createInMemoryD1Database,
} from "../../local-platform/in-memory-bindings.ts";
import {
  createPostgresD1Database,
  createSqliteD1Database,
} from "../../local-platform/persistent-bindings.ts";

export async function resolveDatabase(
  postgresUrl: string | null,
  dataDir: string | null,
  migrationsDir: string,
) {
  return createResolver({
    cloudAdapters: [
      {
        tryCreate() {
          if (!postgresUrl) return null;
          return createPostgresD1Database(postgresUrl, migrationsDir);
        },
      },
    ],
    createPersistent: (dir) =>
      createSqliteD1Database(
        path.join(dir, "db", "control.sqlite"),
        migrationsDir,
      ),
    createInMemory: () => createInMemoryD1Database(),
  })(dataDir);
}
