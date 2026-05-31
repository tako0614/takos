/**
 * Database resolver — selects SQLite/Postgres based on environment.
 */
import path from "node:path";
import { createResolver } from "./resolver-factory.ts";
import { createInMemorySqlDatabase } from "../../local-platform/in-memory-bindings.ts";
import {
  createPostgresSqlDatabase,
  createSqliteSqlDatabase,
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
          return createPostgresSqlDatabase(postgresUrl, migrationsDir);
        },
      },
    ],
    createPersistent: (dir) =>
      createSqliteSqlDatabase(
        path.join(dir, "db", "control.sqlite"),
        migrationsDir,
      ),
    createInMemory: () => createInMemorySqlDatabase(),
  })(dataDir);
}
