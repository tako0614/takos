export { removeLocalDataDir } from "./persistent-shared.ts";
export { createPersistentKvStoreBinding } from "./persistent-kv.ts";
export { createPersistentObjectStore } from "./persistent-r2.ts";
export { createPersistentQueue } from "./persistent-queue.ts";
export { createPersistentDurableObjectNamespace } from "./persistent-durable-objects.ts";
export { splitSqlStatements } from "./d1-sql-rewrite.ts";

export async function createSqliteSqlDatabase(
  dbPath: string,
  migrationsDir: string,
) {
  const mod = await import("./persistent-d1.ts");
  return mod.createSqliteSqlDatabase(dbPath, migrationsDir);
}

export async function createPostgresSqlDatabase(
  connectionString: string,
  migrationsDir: string,
) {
  const mod = await import("./persistent-d1.ts");
  return mod.createPostgresSqlDatabase(connectionString, migrationsDir);
}

export async function createSchemaScopedPostgresSqlDatabase(
  connectionString: string,
  schemaName: string,
) {
  const mod = await import("./persistent-d1.ts");
  return mod.createSchemaScopedPostgresSqlDatabase(
    connectionString,
    schemaName,
  );
}
