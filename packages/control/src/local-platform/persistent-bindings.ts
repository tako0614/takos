export { removeLocalDataDir } from "./persistent-shared.ts";
export { createPersistentKVNamespace } from "./persistent-kv.ts";
export { createPersistentR2Bucket } from "./persistent-r2.ts";
export { createPersistentQueue } from "./persistent-queue.ts";
export { createPersistentDurableObjectNamespace } from "./persistent-durable-objects.ts";
export { splitSqlStatements } from "./d1-sql-rewrite.ts";

export async function createSqliteD1Database(
  dbPath: string,
  migrationsDir: string,
) {
  const mod = await import("./persistent-d1.ts");
  return mod.createSqliteD1Database(dbPath, migrationsDir);
}

export async function createPostgresD1Database(
  connectionString: string,
  migrationsDir: string,
) {
  const mod = await import("./persistent-d1.ts");
  return mod.createPostgresD1Database(connectionString, migrationsDir);
}

export async function createSchemaScopedPostgresD1Database(
  connectionString: string,
  schemaName: string,
) {
  const mod = await import("./persistent-d1.ts");
  return mod.createSchemaScopedPostgresD1Database(connectionString, schemaName);
}
