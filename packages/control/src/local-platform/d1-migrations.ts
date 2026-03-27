import type { Client } from '@libsql/client';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import {
  isRecoverableSqliteSchemaDuplication,
  normalizeMigrationSql,
  normalizePostgresMigrationSql,
  rewriteInsertOrIgnoreForPostgres,
  splitSqlStatements,
  stripLeadingSqlComments,
} from './d1-sql-rewrite.ts';

// ---------------------------------------------------------------------------
// SQLite helpers
// ---------------------------------------------------------------------------

async function sqliteTableExists(client: Client, tableName: string): Promise<boolean> {
  const result = await client.execute({
    sql: 'SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
    args: ['table', tableName],
  });
  return result.rows.length > 0;
}

async function getSqliteTableColumns(client: Client, tableName: string): Promise<Set<string>> {
  const result = await client.execute(`PRAGMA table_info("${tableName}")`);
  return new Set(result.rows.map((row) => String(row.name)));
}

async function stripExistingSqliteServiceAddColumns(client: Client, sql: string): Promise<string> {
  const createsServicesTable = /CREATE TABLE IF NOT EXISTS "services"/i.test(sql);
  const existingColumns = (await sqliteTableExists(client, 'services'))
    ? await getSqliteTableColumns(client, 'services')
    : new Set<string>();
  return sql
    .split('\n')
    .filter((line) => {
      const match = line.match(/ALTER TABLE\s+"services"\s+ADD COLUMN\s+"([^"]+)"/i);
      if (!match) return true;
      if (createsServicesTable) return false;
      return !existingColumns.has(match[1]);
    })
    .join('\n');
}

async function stripRedundantSqliteWorkerToServiceRenames(client: Client, sql: string): Promise<string> {
  const tableColumnsCache = new Map<string, Set<string>>();

  async function getColumns(tableName: string): Promise<Set<string>> {
    const cached = tableColumnsCache.get(tableName);
    if (cached) return cached;
    const columns = (await sqliteTableExists(client, tableName))
      ? await getSqliteTableColumns(client, tableName)
      : new Set<string>();
    tableColumnsCache.set(tableName, columns);
    return columns;
  }

  const lines = await Promise.all(sql.split('\n').map(async (line) => {
    const match = line.match(/ALTER TABLE\s+"([^"]+)"\s+RENAME COLUMN\s+"worker_id"\s+TO\s+"service_id"/i);
    if (!match) return line;

    const columns = await getColumns(match[1]);
    if (columns.has('worker_id') && !columns.has('service_id')) {
      return line;
    }

    return '';
  }));

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// SQLite migration runner
// ---------------------------------------------------------------------------

export async function ensureServerMigrations(client: Client, migrationsDir: string): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS "_takos_self_host_migrations" (
      "name" TEXT NOT NULL PRIMARY KEY,
      "applied_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((entry) => entry.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const fileName of files) {
    const alreadyApplied = await client.execute({
      sql: 'SELECT 1 AS value FROM "_takos_self_host_migrations" WHERE name = ? LIMIT 1',
      args: [fileName],
    });
    if (alreadyApplied.rows.length > 0) continue;

    const migrationSql = normalizeMigrationSql(fileName, await readFile(path.join(migrationsDir, fileName), 'utf8'));
    if (!migrationSql.trim()) {
      await client.execute({
        sql: 'INSERT INTO "_takos_self_host_migrations" (name) VALUES (?)',
        args: [fileName],
      });
      continue;
    }
    const sqliteMigrationSql = await stripRedundantSqliteWorkerToServiceRenames(
      client,
      await stripExistingSqliteServiceAddColumns(client, migrationSql),
    );
    const transaction = await client.transaction('write');
    try {
      for (const statement of splitSqlStatements(sqliteMigrationSql)) {
        const normalizedStatement = stripLeadingSqlComments(statement);
        if (!normalizedStatement) continue;
        try {
          await transaction.execute(normalizedStatement);
        } catch (error) {
          if (isRecoverableSqliteSchemaDuplication(error, normalizedStatement)) {
            continue;
          }
          throw error;
        }
      }
      await transaction.execute({
        sql: 'INSERT INTO "_takos_self_host_migrations" (name) VALUES (?)',
        args: [fileName],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    } finally {
      transaction.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Postgres migration runner
// ---------------------------------------------------------------------------

export async function ensureServerPostgresMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "_takos_self_host_migrations" (
      "name" TEXT NOT NULL PRIMARY KEY,
      "applied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((entry) => entry.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const fileName of files) {
    const alreadyApplied = await pool.query(
      'SELECT 1 AS value FROM "_takos_self_host_migrations" WHERE name = $1 LIMIT 1',
      [fileName],
    );
    if ((alreadyApplied.rowCount ?? 0) > 0) continue;

    const migrationSql = normalizePostgresMigrationSql(
      fileName,
      await readFile(path.join(migrationsDir, fileName), 'utf8'),
    );

    const client = await pool.connect();
    try {
      if (migrationSql.trim()) {
        for (const statement of splitSqlStatements(migrationSql)) {
          const normalizedStatement = stripLeadingSqlComments(statement);
          if (!normalizedStatement) continue;
          const postgresStatement = rewriteInsertOrIgnoreForPostgres(normalizedStatement);
          try {
            await client.query(postgresStatement);
          } catch (error) {
            const pgError = error as NodeJS.ErrnoException & { code?: string };
            const isSchemaDuplication =
              (pgError.code === '42P07' || pgError.code === '42710' || pgError.code === '42701')
              && /^(CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX|ALTER TABLE\s+"[^"]+"\s+ADD (CONSTRAINT|COLUMN))/i.test(postgresStatement);
            if (isSchemaDuplication) continue;
            throw error;
          }
        }
      }
      await client.query('INSERT INTO "_takos_self_host_migrations" (name) VALUES ($1)', [fileName]);
    } finally {
      client.release();
    }
  }
}

// ---------------------------------------------------------------------------
// SQLite table shape repair
// ---------------------------------------------------------------------------

export async function ensureSqliteServicesTableShape(client: Client): Promise<void> {
  if (!(await sqliteTableExists(client, 'services'))) return;

  const columns = await getSqliteTableColumns(client, 'services');
  const alterStatements: string[] = [];

  if (columns.has('worker_type') && !columns.has('service_type')) {
    alterStatements.push(`ALTER TABLE "services" RENAME COLUMN "worker_type" TO "service_type";`);
  }
  if (!columns.has('service_type')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "service_type" TEXT NOT NULL DEFAULT 'app';`);
  }
  if (!columns.has('name_type')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "name_type" TEXT;`);
  }
  if (!columns.has('route_ref')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "route_ref" TEXT;`);
  }
  if (!columns.has('active_deployment_id')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "active_deployment_id" TEXT;`);
  }
  if (!columns.has('fallback_deployment_id')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "fallback_deployment_id" TEXT;`);
  }
  if (!columns.has('current_version')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "current_version" INTEGER NOT NULL DEFAULT 0;`);
  }

  for (const statement of alterStatements) {
    await client.execute(statement);
  }

  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "services_route_ref_key" ON "services"("route_ref");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_services_id_account" ON "services"("id", "account_id");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_services_status" ON "services"("status");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_services_hostname" ON "services"("hostname");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_services_account_status" ON "services"("account_id", "status");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_services_account_id" ON "services"("account_id");`);
}

export async function ensureSqliteAccountsTableShape(client: Client): Promise<void> {
  if (!(await sqliteTableExists(client, 'accounts'))) return;

  const columns = await getSqliteTableColumns(client, 'accounts');
  const alterStatements: string[] = [];

  if (!columns.has('security_posture')) {
    alterStatements.push(`ALTER TABLE "accounts" ADD COLUMN "security_posture" TEXT NOT NULL DEFAULT 'standard';`);
  }
  if (!columns.has('head_snapshot_id')) {
    alterStatements.push(`ALTER TABLE "accounts" ADD COLUMN "head_snapshot_id" TEXT;`);
  }

  for (const statement of alterStatements) {
    await client.execute(statement);
  }
}

// ---------------------------------------------------------------------------
// Postgres table shape repair
// ---------------------------------------------------------------------------

async function postgresTableExists(pool: Pool, tableName: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = $1
      LIMIT 1`,
    [tableName],
  );
  return (result.rowCount ?? 0) > 0;
}

async function getPostgresTableColumns(pool: Pool, tableName: string): Promise<Set<string>> {
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1`,
    [tableName],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

export async function ensurePostgresServicesTableShape(pool: Pool): Promise<void> {
  if (!(await postgresTableExists(pool, 'services'))) return;

  const columns = await getPostgresTableColumns(pool, 'services');
  const alterStatements: string[] = [];

  if (columns.has('worker_type') && !columns.has('service_type')) {
    alterStatements.push(`ALTER TABLE "services" RENAME COLUMN "worker_type" TO "service_type";`);
  }
  if (!columns.has('service_type')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "service_type" TEXT NOT NULL DEFAULT 'app';`);
  }
  if (!columns.has('name_type')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "name_type" TEXT;`);
  }
  if (!columns.has('route_ref')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "route_ref" TEXT;`);
  }
  if (!columns.has('active_deployment_id')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "active_deployment_id" TEXT;`);
  }
  if (!columns.has('fallback_deployment_id')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "fallback_deployment_id" TEXT;`);
  }
  if (!columns.has('current_version')) {
    alterStatements.push(`ALTER TABLE "services" ADD COLUMN "current_version" INTEGER NOT NULL DEFAULT 0;`);
  }

  for (const statement of alterStatements) {
    await pool.query(statement);
  }

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "services_route_ref_key" ON "services"("route_ref");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_services_id_account" ON "services"("id", "account_id");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_services_status" ON "services"("status");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_services_hostname" ON "services"("hostname");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_services_account_status" ON "services"("account_id", "status");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_services_account_id" ON "services"("account_id");`);
}

export async function ensurePostgresAccountsTableShape(pool: Pool): Promise<void> {
  if (!(await postgresTableExists(pool, 'accounts'))) return;

  const columns = await getPostgresTableColumns(pool, 'accounts');
  const alterStatements: string[] = [];

  if (!columns.has('security_posture')) {
    alterStatements.push(`ALTER TABLE "accounts" ADD COLUMN "security_posture" TEXT NOT NULL DEFAULT 'standard';`);
  }
  if (!columns.has('head_snapshot_id')) {
    alterStatements.push(`ALTER TABLE "accounts" ADD COLUMN "head_snapshot_id" TEXT;`);
  }

  for (const statement of alterStatements) {
    await pool.query(statement);
  }
}
