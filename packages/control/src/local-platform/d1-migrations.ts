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
  const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const result = await client.execute(`PRAGMA table_info("${safeName}")`);
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
      await transaction.rollback().catch(() => undefined /* rollback: best-effort after migration failure */);
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
  if (!(await sqliteTableExists(client, 'services'))) {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS "services" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "account_id" TEXT NOT NULL,
        "group_id" TEXT,
        "service_type" TEXT NOT NULL DEFAULT 'app',
        "name_type" TEXT,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "config" TEXT,
        "hostname" TEXT,
        "route_ref" TEXT,
        "slug" TEXT,
        "active_deployment_id" TEXT,
        "fallback_deployment_id" TEXT,
        "current_version" INTEGER NOT NULL DEFAULT 0,
        "workload_kind" TEXT,
        "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

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
  if (!(await sqliteTableExists(client, 'accounts'))) {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS "accounts" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "type" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'active',
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL UNIQUE,
        "description" TEXT,
        "picture" TEXT,
        "bio" TEXT,
        "email" TEXT,
        "trust_tier" TEXT NOT NULL DEFAULT 'new',
        "setup_completed" INTEGER NOT NULL DEFAULT 0,
        "default_repository_id" TEXT,
        "head_snapshot_id" TEXT,
        "ai_model" TEXT DEFAULT 'gpt-5.4-nano',
        "ai_provider" TEXT DEFAULT 'openai',
        "security_posture" TEXT NOT NULL DEFAULT 'standard',
        "owner_account_id" TEXT,
        "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

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

  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_accounts_type" ON "accounts"("type");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_accounts_slug" ON "accounts"("slug");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_accounts_owner_account_id" ON "accounts"("owner_account_id");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_accounts_email" ON "accounts"("email");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_accounts_default_repository_id" ON "accounts"("default_repository_id");`);
}

export async function ensureSqliteDeploymentsTableShape(client: Client): Promise<void> {
  if (!(await sqliteTableExists(client, 'deployments'))) {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS "deployments" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "service_id" TEXT NOT NULL,
        "account_id" TEXT NOT NULL,
        "version" INTEGER NOT NULL,
        "artifact_ref" TEXT,
        "bundle_r2_key" TEXT,
        "bundle_hash" TEXT,
        "bundle_size" INTEGER,
        "wasm_r2_key" TEXT,
        "wasm_hash" TEXT,
        "assets_manifest" TEXT,
        "runtime_config_snapshot_json" TEXT NOT NULL DEFAULT '{}',
        "bindings_snapshot_encrypted" TEXT,
        "env_vars_snapshot_encrypted" TEXT,
        "deploy_state" TEXT NOT NULL DEFAULT 'pending',
        "current_step" TEXT,
        "step_error" TEXT,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "routing_status" TEXT NOT NULL DEFAULT 'archived',
        "routing_weight" INTEGER NOT NULL DEFAULT 0,
        "deployed_by" TEXT,
        "deploy_message" TEXT,
        "provider_name" TEXT NOT NULL DEFAULT 'workers-dispatch',
        "target_json" TEXT NOT NULL DEFAULT '{}',
        "provider_state_json" TEXT NOT NULL DEFAULT '{}',
        "artifact_kind" TEXT NOT NULL DEFAULT 'worker-bundle',
        "idempotency_key" TEXT UNIQUE,
        "is_rollback" INTEGER NOT NULL DEFAULT 0,
        "rollback_from_version" INTEGER,
        "rolled_back_at" TEXT,
        "rolled_back_by" TEXT,
        "started_at" TEXT,
        "completed_at" TEXT,
        "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_deployments_service_version" ON "deployments"("service_id", "version");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_deployments_service_routing_status" ON "deployments"("service_id", "routing_status");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_deployments_service_id" ON "deployments"("service_id");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_deployments_service_created_at" ON "deployments"("service_id", "created_at");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_deployments_status" ON "deployments"("status");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_deployments_account_status" ON "deployments"("account_id", "status");`);
  await client.execute(`CREATE INDEX IF NOT EXISTS "idx_deployments_account_id" ON "deployments"("account_id");`);
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
  if (!(await postgresTableExists(pool, 'services'))) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "services" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "account_id" TEXT NOT NULL,
        "group_id" TEXT,
        "service_type" TEXT NOT NULL DEFAULT 'app',
        "name_type" TEXT,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "config" TEXT,
        "hostname" TEXT,
        "route_ref" TEXT,
        "slug" TEXT,
        "active_deployment_id" TEXT,
        "fallback_deployment_id" TEXT,
        "current_version" INTEGER NOT NULL DEFAULT 0,
        "workload_kind" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

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
  if (!(await postgresTableExists(pool, 'accounts'))) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "accounts" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "type" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'active',
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL UNIQUE,
        "description" TEXT,
        "picture" TEXT,
        "bio" TEXT,
        "email" TEXT,
        "trust_tier" TEXT NOT NULL DEFAULT 'new',
        "setup_completed" BOOLEAN NOT NULL DEFAULT false,
        "default_repository_id" TEXT,
        "head_snapshot_id" TEXT,
        "ai_model" TEXT DEFAULT 'gpt-5.4-nano',
        "ai_provider" TEXT DEFAULT 'openai',
        "security_posture" TEXT NOT NULL DEFAULT 'standard',
        "owner_account_id" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

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

  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_accounts_type" ON "accounts"("type");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_accounts_slug" ON "accounts"("slug");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_accounts_owner_account_id" ON "accounts"("owner_account_id");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_accounts_email" ON "accounts"("email");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_accounts_default_repository_id" ON "accounts"("default_repository_id");`);
}

export async function ensurePostgresDeploymentsTableShape(pool: Pool): Promise<void> {
  if (!(await postgresTableExists(pool, 'deployments'))) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "deployments" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "service_id" TEXT NOT NULL,
        "account_id" TEXT NOT NULL,
        "version" INTEGER NOT NULL,
        "artifact_ref" TEXT,
        "bundle_r2_key" TEXT,
        "bundle_hash" TEXT,
        "bundle_size" INTEGER,
        "wasm_r2_key" TEXT,
        "wasm_hash" TEXT,
        "assets_manifest" TEXT,
        "runtime_config_snapshot_json" TEXT NOT NULL DEFAULT '{}',
        "bindings_snapshot_encrypted" TEXT,
        "env_vars_snapshot_encrypted" TEXT,
        "deploy_state" TEXT NOT NULL DEFAULT 'pending',
        "current_step" TEXT,
        "step_error" TEXT,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "routing_status" TEXT NOT NULL DEFAULT 'archived',
        "routing_weight" INTEGER NOT NULL DEFAULT 0,
        "deployed_by" TEXT,
        "deploy_message" TEXT,
        "provider_name" TEXT NOT NULL DEFAULT 'workers-dispatch',
        "target_json" TEXT NOT NULL DEFAULT '{}',
        "provider_state_json" TEXT NOT NULL DEFAULT '{}',
        "artifact_kind" TEXT NOT NULL DEFAULT 'worker-bundle',
        "idempotency_key" TEXT UNIQUE,
        "is_rollback" BOOLEAN NOT NULL DEFAULT false,
        "rollback_from_version" INTEGER,
        "rolled_back_at" TIMESTAMPTZ,
        "rolled_back_by" TEXT,
        "started_at" TIMESTAMPTZ,
        "completed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_deployments_service_version" ON "deployments"("service_id", "version");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_deployments_service_routing_status" ON "deployments"("service_id", "routing_status");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_deployments_service_id" ON "deployments"("service_id");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_deployments_service_created_at" ON "deployments"("service_id", "created_at");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_deployments_status" ON "deployments"("status");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_deployments_account_status" ON "deployments"("account_id", "status");`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_deployments_account_id" ON "deployments"("account_id");`);
}
