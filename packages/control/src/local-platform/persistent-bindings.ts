import { createClient, type Client, type InArgs, type InStatement, type ResultSet } from '@libsql/client';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  DurableObjectNamespace,
  DurableObjectStub,
  KVNamespace,
  Queue,
  R2Bucket,
  R2Object,
  R2ObjectBody,
} from '../shared/types/bindings.ts';
import {
  createInMemoryDurableObjectNamespace,
  createInMemoryQueue,
  type InMemoryDurableObjectNamespace,
} from './in-memory-bindings.ts';
import type { LocalQueue, LocalQueueRecord } from './queue-runtime.ts';

type KvRecord = {
  value: string;
  expiration?: number;
  metadata?: unknown;
};

type KvState = Record<string, KvRecord>;

type BucketRecord = {
  key: string;
  bodyBase64: string;
  uploadedAt: string;
  customMetadata: Record<string, string>;
  httpMetadata: Record<string, string>;
};

type BucketState = Record<string, BucketRecord>;

type QueueState<T = unknown> = {
  messages: T[];
};

type ServerD1Database = D1Database & {
  close(): void;
};

function createD1Meta(
  servedBy: string,
  overrides?: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    changed_db: false,
    changes: 0,
    duration: 0,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    served_by: servedBy,
    size_after: 0,
    ...overrides,
  };
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function encodeBase64(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString('base64');
}

function decodeBase64(value: string): ArrayBuffer {
  const buffer = Buffer.from(value, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function toBuffer(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
): Promise<ArrayBuffer> {
  if (value === null) return new ArrayBuffer(0);
  if (typeof value === 'string') return new TextEncoder().encode(value).buffer;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  if (value instanceof Blob) return value.arrayBuffer();
  return new Response(value).arrayBuffer();
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureParentDirectory(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeArg(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value === undefined) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' || typeof value === 'string' || value === null) return value;
  return JSON.stringify(value);
}

function normalizeArgs(values: unknown[]): InArgs {
  return values.map((value) => normalizeArg(value)) as InArgs;
}

function normalizePostgresArg(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return JSON.stringify(value);
}

function normalizePostgresArgs(values: unknown[]): unknown[] {
  return values.map((value) => normalizePostgresArg(value));
}

function rowToObject(row: ResultSet['rows'][number], columns: string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
}

function rowToObjectFromRecord(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}

function resultSetToD1Result<T>(result: ResultSet): D1Result<T> {
  return {
    results: result.rows.map((row) => rowToObject(row, result.columns) as T),
    success: true,
    meta: createD1Meta('local-sqlite', {
      changed_db: result.rowsAffected > 0,
      changes: result.rowsAffected,
      last_row_id: result.lastInsertRowid == null ? 0 : Number(result.lastInsertRowid),
      rows_read: result.rows.length,
      rows_written: result.rowsAffected,
    }),
  } as D1Result<T>;
}

function queryResultToD1Result<T>(
  result: QueryResult<Record<string, unknown>>,
  servedBy: string,
): D1Result<T> {
  const columns = result.fields.map((field: { name: string }) => field.name);
  return {
    results: result.rows.map((row: Record<string, unknown>) => rowToObjectFromRecord(row, columns) as T),
    success: true,
    meta: createD1Meta(servedBy, {
      changed_db: (result.rowCount ?? 0) > 0,
      changes: result.rowCount ?? 0,
      last_row_id: 0,
      rows_read: result.rows.length,
      rows_written: result.rowCount ?? 0,
    }),
  } as D1Result<T>;
}

function replaceQuestionMarkParameters(query: string): string {
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

function normalizePostgresSql(query: string): string {
  return replaceQuestionMarkParameters(
    query.replace(/\bBEGIN\s+(IMMEDIATE|EXCLUSIVE|DEFERRED)\b/gi, 'BEGIN'),
  );
}

function classifyTransactionSql(query: string): 'begin' | 'commit' | 'rollback' | null {
  const trimmed = query.trim().replace(/;$/, '');
  if (/^BEGIN$/i.test(trimmed)) return 'begin';
  if (/^COMMIT$/i.test(trimmed)) return 'commit';
  if (/^ROLLBACK$/i.test(trimmed)) return 'rollback';
  return null;
}

function toPgRawRows(result: QueryResult<Record<string, unknown>>): [string[], ...unknown[]] | unknown[] {
  const columns = result.fields.map((field: { name: string }) => field.name);
  const rows = result.rows.map((row: Record<string, unknown>) => columns.map((column) => row[column]));
  return [columns, ...rows];
}

function normalizeMigrationSql(fileName: string, sql: string): string {
  if (
    fileName === '0011_service_registry_tables.sql' ||
    fileName === '0011_services_physical_tables.sql' ||
    fileName === '0012_service_tables.sql' ||
    fileName === '0013_service_table_shape_repair.sql' ||
    fileName === '0018_service_side_columns.sql'
  ) {
    return '';
  }

  return sql
    .split('\n')
    .filter((line) => !(
      line.includes('"accounts_google_sub_key"') ||
      line.includes('"accounts_google_sub_idx"') ||
      line.includes('"accounts_takos_auth_id_idx"')
    ))
    .join('\n');
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inTrigger = false;
  let dollarQuoteTag: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const previous = index > 0 ? sql[index - 1] : '';
    const next = index + 1 < sql.length ? sql[index + 1] : '';

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        current += dollarQuoteTag;
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      } else {
        current += char;
      }
      continue;
    }

    if (inLineComment) {
      current += char;
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (previous === '*' && char === '/') inBlockComment = false;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '-' && next === '-') {
      inLineComment = true;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '/' && next === '*') {
      inBlockComment = true;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === '$') {
      const dollarQuoteMatch = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (dollarQuoteMatch) {
        dollarQuoteTag = dollarQuoteMatch[0];
        current += dollarQuoteTag;
        index += dollarQuoteTag.length - 1;
        continue;
      }
    }

    if (char === '\'' && !inDoubleQuote && previous !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && previous !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    }

    current += char;
    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (!trimmed) {
        current = '';
        continue;
      }
      if (!inTrigger && /\bCREATE\s+TRIGGER\b/i.test(trimmed)) {
        inTrigger = true;
      }
      if (inTrigger) {
        if (/\bEND;\s*$/i.test(trimmed)) {
          statements.push(trimmed);
          current = '';
          inTrigger = false;
        }
      } else {
        statements.push(trimmed);
        current = '';
      }
    }
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing.endsWith(';') ? trailing : `${trailing};`);
  return statements;
}

function stripLeadingSqlComments(statement: string): string {
  return statement
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();
}

function isRecoverableSqliteSchemaDuplication(error: unknown, normalizedStatement: string): boolean {
  const sqliteError = error as { message?: string; code?: string; rawCode?: number };
  const message = sqliteError.message ?? '';
  if (!/already exists|duplicate column name/i.test(message)) {
    return false;
  }

  return /^(CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX|ALTER TABLE\s+"[^"]+"\s+ADD COLUMN)/i.test(
    normalizedStatement,
  );
}

function rewriteCreateTableForPostgres(statement: string): string[] {
  const tableMatch = statement.match(/CREATE TABLE\s+"([^"]+)"/i);
  if (!tableMatch) return [statement];

  const tableName = tableMatch[1];
  const lines = statement.replace(/;$/, '').split('\n');
  const retainedLines: string[] = [];
  const foreignKeyStatements: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('CONSTRAINT ') && trimmed.includes(' FOREIGN KEY ')) {
      foreignKeyStatements.push(
        `ALTER TABLE "${tableName}" ADD ${trimmed.replace(/,$/, '')};`,
      );
      continue;
    }
    retainedLines.push(line);
  }

  const createTableStatement = `${retainedLines.join('\n').replace(/,\s*\n\)\s*$/m, '\n)')};`;
  return [createTableStatement, ...foreignKeyStatements];
}

function rewriteInsertOrIgnoreForPostgres(statement: string): string {
  if (!/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(statement)) {
    return statement;
  }

  const withoutKeyword = statement.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
  const trimmed = withoutKeyword.trimEnd();
  if (/ON\s+CONFLICT\b/i.test(trimmed)) {
    return withoutKeyword;
  }
  return `${trimmed.replace(/;?\s*$/, '')} ON CONFLICT DO NOTHING;`;
}

function normalizePostgresMigrationSql(fileName: string, sql: string): string {
  if (fileName === '0014_deployments_service_id.sql') {
    return `ALTER TABLE "deployments" RENAME COLUMN "worker_id" TO "service_id";`;
  }

  if (fileName === '0020_apps_service_id.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'apps' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "apps" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_apps_worker_id";
CREATE INDEX IF NOT EXISTS "idx_apps_service_id" ON "apps" ("service_id");
`;
  }

  if (fileName === '0021_shortcut_group_items_service_id.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shortcut_group_items' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "shortcut_group_items" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
`;
  }

  if (fileName === '0022_mcp_servers_service_id.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mcp_servers' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "mcp_servers" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_mcp_servers_worker_id";
CREATE INDEX IF NOT EXISTS "idx_mcp_servers_service_id" ON "mcp_servers" ("service_id");
`;
  }

  if (fileName === '0023_file_handlers_service_hostname.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'file_handlers' AND column_name = 'worker_hostname'
  ) THEN
    ALTER TABLE "file_handlers" RENAME COLUMN "worker_hostname" TO "service_hostname";
  END IF;
END $$;
`;
  }

  if (fileName === '0023_runs_service_id.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'runs' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "runs" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_runs_worker_id";
CREATE INDEX IF NOT EXISTS "idx_runs_service_id" ON "runs" ("service_id");
`;
  }

  if (fileName === '0027_runs_service_heartbeat.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'runs' AND column_name = 'worker_heartbeat'
  ) THEN
    ALTER TABLE "runs" RENAME COLUMN "worker_heartbeat" TO "service_heartbeat";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_runs_worker_heartbeat";
CREATE INDEX IF NOT EXISTS "idx_runs_service_heartbeat" ON "runs" ("service_heartbeat");
`;
  }

  if (fileName === '0029_drop_legacy_worker_mirrors.sql') {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'services'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS "trg_services_mirror_insert_to_workers" ON "services"';
    EXECUTE 'DROP TRIGGER IF EXISTS "trg_services_mirror_update_to_workers" ON "services"';
    EXECUTE 'DROP TRIGGER IF EXISTS "trg_services_mirror_delete_to_workers" ON "services"';
  END IF;
END $$;

DROP TABLE IF EXISTS "worker_bindings";
DROP TABLE IF EXISTS "worker_common_env_links";
DROP TABLE IF EXISTS "workers";
`;
  }

  if (
    fileName === '0018_service_adjacent_service_id_columns.sql'
    || fileName === '0018_service_side_columns.sql'
  ) {
    return `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'common_env_audit_logs' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "common_env_audit_logs" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_common_env_audit_logs_worker_created_at";
CREATE INDEX IF NOT EXISTS "idx_common_env_audit_logs_service_created_at"
  ON "common_env_audit_logs" ("service_id", "created_at");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'common_env_reconcile_jobs' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "common_env_reconcile_jobs" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_common_env_reconcile_jobs_account_worker_status";
CREATE INDEX IF NOT EXISTS "idx_common_env_reconcile_jobs_account_service_status"
  ON "common_env_reconcile_jobs" ("account_id", "service_id", "status");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'custom_domains' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "custom_domains" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_custom_domains_worker_id";
CREATE INDEX IF NOT EXISTS "idx_custom_domains_service_id"
  ON "custom_domains" ("service_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'managed_takos_tokens' AND column_name = 'worker_id'
  ) THEN
    ALTER TABLE "managed_takos_tokens" RENAME COLUMN "worker_id" TO "service_id";
  END IF;
END $$;
DROP INDEX IF EXISTS "idx_managed_takos_tokens_worker_env";
DROP INDEX IF EXISTS "idx_managed_takos_tokens_worker_id";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_managed_takos_tokens_service_env"
  ON "managed_takos_tokens" ("service_id", "env_name");
CREATE INDEX IF NOT EXISTS "idx_managed_takos_tokens_service_id"
  ON "managed_takos_tokens" ("service_id");
`;
  }

  if (
    fileName === '0015_workers_deployments_fk_repair.sql' ||
    fileName === '0016_deployment_events_deployments_fk_repair.sql' ||
    fileName === '0017_drop_worker_binding_mirrors.sql' ||
    fileName === '0018_service_side_columns.sql'
  ) {
    return '';
  }

  const transformed = normalizeMigrationSql(fileName, sql)
    .replace(/^\s*PRAGMA\s+[^;]+;?\s*$/gim, '')
    .replace(/\bDATETIME\b/g, 'TIMESTAMPTZ')
    .replace(
      /"([^"]+)"\s+INTEGER\s+NOT\s+NULL\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi,
      '"$1" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY',
    )
    .replace(
      /"([^"]+)"\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi,
      '"$1" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY',
    );

  const rewrittenStatements: string[] = [];
  const deferredForeignKeys: string[] = [];

  for (const statement of splitSqlStatements(transformed)) {
    const postgresStatement = rewriteInsertOrIgnoreForPostgres(statement);
    const [primaryStatement, ...foreignKeys] = rewriteCreateTableForPostgres(postgresStatement);
    rewrittenStatements.push(primaryStatement);
    deferredForeignKeys.push(...foreignKeys);
  }

  return [...rewrittenStatements, ...deferredForeignKeys].join('\n\n');
}

function createPreparedStatement(client: Client, query: string, boundArgs: unknown[] = []): D1PreparedStatement {
  const execute = async (): Promise<ResultSet> => client.execute({
    sql: query,
    args: normalizeArgs(boundArgs),
  } as InStatement);

  const statement = {
    bind(...values: unknown[]) {
      return createPreparedStatement(client, query, values);
    },
    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      const result = await execute();
      const row = result.rows[0];
      if (!row) return null;
      if (colName) return (row as Record<string, unknown>)[colName] as T;
      return rowToObject(row, result.columns) as T;
    },
    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      return resultSetToD1Result<T>(await execute());
    },
    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      return resultSetToD1Result<T>(await execute());
    },
    async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
      const result = await execute();
      const rows = result.rows.map((row) => result.columns.map((column) => row[column])) as T[];
      if (options?.columnNames) {
        return [result.columns, ...rows] as [string[], ...T[]];
      }
      return rows;
    },
  };

  return statement as unknown as D1PreparedStatement;
}

type PostgresRunner = {
  query(queryText: string, values?: unknown[]): Promise<QueryResult<Record<string, unknown>>>;
};

function createPostgresPreparedStatement(
  runner: PostgresRunner,
  query: string,
  boundArgs: unknown[] = [],
  servedBy = 'local-postgres',
): D1PreparedStatement {
  const execute = async (): Promise<QueryResult<Record<string, unknown>>> => {
    const normalized = normalizePostgresSql(query);
    return runner.query(normalized, normalizePostgresArgs(boundArgs));
  };

  const statement = {
    bind(...values: unknown[]) {
      return createPostgresPreparedStatement(runner, query, values, servedBy);
    },
    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      const result = await execute();
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      if (colName) return row[colName] as T;
      const columns = result.fields.map((field: { name: string }) => field.name);
      return rowToObjectFromRecord(row, columns) as T;
    },
    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      return queryResultToD1Result<T>(await execute(), servedBy);
    },
    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      return queryResultToD1Result<T>(await execute(), servedBy);
    },
    async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
      const result = await execute();
      if (options?.columnNames) {
        return toPgRawRows(result) as [string[], ...T[]];
      }
      const columns = result.fields.map((field: { name: string }) => field.name);
      return result.rows.map((row: Record<string, unknown>) => columns.map((column) => row[column])) as T[];
    },
  };

  return statement as unknown as D1PreparedStatement;
}

function isExactTransactionControlSql(query: string): boolean {
  const trimmed = query.trim().replace(/;$/, '');
  return /^(BEGIN|COMMIT|ROLLBACK)$/i.test(trimmed);
}

function createSequentialBatch<T>(
  runStatement: (statement: D1PreparedStatement) => Promise<D1Result<T>>,
): (statements: D1PreparedStatement[]) => Promise<D1Result<T>[]> {
  return async (statements: D1PreparedStatement[]) => {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      results.push(await runStatement(statement));
    }
    return results;
  };
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

async function ensureServerMigrations(client: Client, migrationsDir: string): Promise<void> {
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

async function ensureServerPostgresMigrations(pool: Pool, migrationsDir: string): Promise<void> {
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

async function ensureSqliteServicesTableShape(client: Client): Promise<void> {
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

async function ensureSqliteAccountsTableShape(client: Client): Promise<void> {
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

async function ensurePostgresServicesTableShape(pool: Pool): Promise<void> {
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

async function ensurePostgresAccountsTableShape(pool: Pool): Promise<void> {
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

export async function createSqliteD1Database(dbPath: string, migrationsDir: string): Promise<ServerD1Database> {
  await ensureParentDirectory(dbPath);
  const client = createClient({ url: pathToFileURL(dbPath).href });
  await ensureServerMigrations(client, migrationsDir);
  await ensureSqliteServicesTableShape(client);
  await ensureSqliteAccountsTableShape(client);

  const runStatement = <T = Record<string, unknown>>(statement: D1PreparedStatement) => statement.run<T>();
  const session = {
    prepare(query: string) {
      return createPreparedStatement(client, query);
    },
    batch: createSequentialBatch(runStatement),
    getBookmark() {
      return null;
    },
  };

  const db = {
    prepare(query: string) {
      return createPreparedStatement(client, query);
    },
    batch: createSequentialBatch(runStatement),
    async exec(query: string) {
      const startedAt = Date.now();
      await client.executeMultiple(query);
      return { count: 0, duration: Date.now() - startedAt };
    },
    withSession() {
      return session;
    },
    async dump() {
      const bytes = await readFile(dbPath);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
    close() {
      client.close();
    },
  };

  return db as unknown as ServerD1Database;
}

export async function createPostgresD1Database(connectionString: string): Promise<ServerD1Database> {
  const pool = new Pool({ connectionString });
  const migrationsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'db',
    'migrations',
  );
  await ensureServerPostgresMigrations(pool, migrationsDir);
  await ensurePostgresServicesTableShape(pool);
  await ensurePostgresAccountsTableShape(pool);
  let transactionClient: PoolClient | null = null;

  async function getTransactionClient(): Promise<PoolClient> {
    if (transactionClient) return transactionClient;
    const client = await pool.connect();
    transactionClient = client;
    try {
      return client;
    } catch (error) {
      transactionClient = null;
      client.release();
      throw error;
    }
  }

  async function releaseTransactionClient(): Promise<void> {
    const client = transactionClient;
    transactionClient = null;
    client?.release();
  }

  async function runQuery(
    queryText: string,
    values: unknown[] = [],
  ): Promise<QueryResult<Record<string, unknown>>> {
    const normalized = normalizePostgresSql(queryText);
    const transactionKind = isExactTransactionControlSql(normalized) ? classifyTransactionSql(normalized) : null;

    if (transactionKind === 'begin') {
      const client = await getTransactionClient();
      try {
        return await client.query(normalized, values);
      } catch (error) {
        await releaseTransactionClient();
        throw error;
      }
    }

    if (transactionClient) {
      const client = transactionClient;
      try {
        const result = await client.query(normalized, values);
        if (transactionKind === 'commit' || transactionKind === 'rollback') {
          await releaseTransactionClient();
        }
        return result;
      } catch (error) {
        if (transactionKind === 'commit') {
          await client.query('ROLLBACK').catch(() => undefined);
        }
        await releaseTransactionClient();
        throw error;
      }
    }

    return pool.query(normalized, values);
  }

  const runStatement = <T = Record<string, unknown>>(statement: D1PreparedStatement) => statement.run<T>();
  const session = {
    prepare(query: string) {
      return createPostgresPreparedStatement({ query: runQuery }, query);
    },
    batch: createSequentialBatch(runStatement),
    getBookmark() {
      return null;
    },
  };

  const db = {
    prepare(query: string) {
      return createPostgresPreparedStatement({ query: runQuery }, query);
    },
    batch: createSequentialBatch(runStatement),
    async exec(query: string) {
      const startedAt = Date.now();
      await runQuery(query);
      return { count: 0, duration: Date.now() - startedAt };
    },
    withSession() {
      return session;
    },
    async dump() {
      throw new Error('DB.dump() is not implemented for the local Postgres adapter');
    },
    close() {
      void pool.end();
    },
  };

  return db as unknown as ServerD1Database;
}

export function createPersistentKVNamespace(filePath: string): KVNamespace {
  let cache: KvState | null = null;

  async function loadState(): Promise<KvState> {
    if (cache) return cache;
    cache = await readJsonFile<KvState>(filePath, {});
    return cache;
  }

  async function flushState(): Promise<void> {
    if (!cache) return;
    await writeJsonFile(filePath, cache);
  }

  async function getRecord(key: string): Promise<KvRecord | null> {
    const state = await loadState();
    const record = state[key];
    if (!record) return null;
    if (record.expiration && Date.now() >= record.expiration) {
      delete state[key];
      await flushState();
      return null;
    }
    return record;
  }

  const kv = {
    async get<T = unknown>(key: string, arg?: unknown): Promise<T | string | ArrayBuffer | ReadableStream | null> {
      const record = await getRecord(key);
      if (!record) return null;

      const type = typeof arg === 'string'
        ? arg
        : typeof arg === 'object' && arg && 'type' in (arg as Record<string, unknown>)
          ? (arg as { type?: string }).type ?? 'text'
          : 'text';

      if (type === 'json') return JSON.parse(record.value) as T;
      if (type === 'arrayBuffer') return new TextEncoder().encode(record.value).buffer;
      if (type === 'stream') return new Blob([record.value]).stream();
      return record.value;
    },
    async getWithMetadata<T = string>(key: string, arg?: unknown) {
      const record = await getRecord(key);
      if (!record) {
        return { value: null, metadata: null, cacheStatus: null };
      }
      const value = await kv.get<T>(key, arg);
      return {
        value,
        metadata: record.metadata ?? null,
        cacheStatus: null,
      };
    },
    async put(
      key: string,
      value: string | ArrayBuffer | ReadableStream | ArrayBufferView,
      options?: { expirationTtl?: number; expiration?: number; metadata?: unknown },
    ) {
      const state = await loadState();
      let text: string;
      if (typeof value === 'string') {
        text = value;
      } else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        text = new TextDecoder().decode(value);
      } else {
        text = await new Response(value).text();
      }

      state[key] = {
        value: text,
        expiration: options?.expiration
          ? options.expiration * 1000
          : options?.expirationTtl
            ? Date.now() + options.expirationTtl * 1000
            : undefined,
        metadata: options?.metadata,
      };
      await flushState();
    },
    async delete(key: string) {
      const state = await loadState();
      delete state[key];
      await flushState();
    },
    async list<Metadata = unknown>(options?: { prefix?: string; limit?: number; cursor?: string }) {
      const state = await loadState();
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
      const entries = Object.entries(state)
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b));
      const page = entries.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return {
        keys: page.map(([name, record]) => ({
          name,
          expiration: record.expiration ? Math.floor(record.expiration / 1000) : undefined,
          metadata: record.metadata as Metadata,
        })),
        list_complete: nextOffset >= entries.length,
        cursor: nextOffset >= entries.length ? '' : String(nextOffset),
        cacheStatus: null,
      };
    },
  };

  return kv as unknown as KVNamespace;
}

function createR2Object(
  key: string,
  bytes: ArrayBuffer,
  customMetadata: Record<string, string>,
  httpMetadata: Record<string, string>,
  uploadedAt: string,
): R2ObjectBody {
  const blob = new Blob([bytes]);
  const etag = `"${hashKey(key)}-${bytes.byteLength}"`;
  const uploaded = new Date(uploadedAt);
  const object = {
    key,
    version: 'local',
    size: bytes.byteLength,
    etag,
    httpEtag: etag,
    uploaded,
    checksums: { toJSON: () => ({}) },
    httpMetadata,
    customMetadata,
    range: undefined,
    body: blob.stream(),
    bodyUsed: false,
    async arrayBuffer() {
      return bytes.slice(0);
    },
    async bytes() {
      return new Uint8Array(bytes.slice(0));
    },
    async text() {
      return new TextDecoder().decode(bytes);
    },
    async json<T>() {
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    },
    async blob() {
      return blob;
    },
    writeHttpMetadata(headers: Headers) {
      for (const [name, value] of Object.entries(httpMetadata)) {
        headers.set(name, value);
      }
    },
  };

  return object as unknown as R2ObjectBody;
}

export function createPersistentR2Bucket(filePath: string): R2Bucket {
  let cache: BucketState | null = null;

  async function loadState(): Promise<BucketState> {
    if (cache) return cache;
    cache = await readJsonFile<BucketState>(filePath, {});
    return cache;
  }

  async function flushState(): Promise<void> {
    if (!cache) return;
    await writeJsonFile(filePath, cache);
  }

  const bucket = {
    async head(key: string) {
      const state = await loadState();
      const record = state[key];
      if (!record) return null;
      const object = createR2Object(
        record.key,
        decodeBase64(record.bodyBase64),
        record.customMetadata,
        record.httpMetadata,
        record.uploadedAt,
      );
      return {
        ...object,
        body: null,
      } as unknown as R2Object;
    },
    async get(key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } }) {
      const state = await loadState();
      const record = state[key];
      if (!record) return null;

      let bytes = decodeBase64(record.bodyBase64);
      if (options?.range) {
        const offset = options.range.suffix
          ? Math.max(0, bytes.byteLength - options.range.suffix)
          : options.range.offset ?? 0;
        const end = options.range.length !== undefined
          ? Math.min(bytes.byteLength, offset + options.range.length)
          : bytes.byteLength;
        bytes = bytes.slice(offset, end);
      }

      return createR2Object(
        record.key,
        bytes,
        record.customMetadata,
        record.httpMetadata,
        record.uploadedAt,
      );
    },
    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
      options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> },
    ) {
      const state = await loadState();
      const bytes = await toBuffer(value);
      state[key] = {
        key,
        bodyBase64: encodeBase64(bytes),
        uploadedAt: new Date().toISOString(),
        customMetadata: options?.customMetadata ?? {},
        httpMetadata: options?.httpMetadata ?? {},
      };
      await flushState();
      return (await bucket.head(key))!;
    },
    async delete(key: string | string[]) {
      const state = await loadState();
      const keys = Array.isArray(key) ? key : [key];
      for (const item of keys) delete state[item];
      await flushState();
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      const state = await loadState();
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
      const keys = Object.keys(state)
        .filter((key) => key.startsWith(prefix))
        .sort((a, b) => a.localeCompare(b));
      const page = keys.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return {
        objects: await Promise.all(page.map(async (key) => (await bucket.head(key))!)),
        truncated: nextOffset < keys.length,
        cursor: nextOffset < keys.length ? String(nextOffset) : undefined,
        delimitedPrefixes: [],
      };
    },
    async createMultipartUpload() {
      throw new Error('Multipart upload is not implemented in the local adapter');
    },
    resumeMultipartUpload() {
      throw new Error('Multipart upload is not implemented in the local adapter');
    },
  };

  return bucket as unknown as R2Bucket;
}

export async function removeLocalDataDir(dataDir: string): Promise<void> {
  await rm(dataDir, { recursive: true, force: true });
}

export function createPersistentQueue<T = unknown>(queueFile: string, queueName = 'takos-runs'): Queue<T> {
  type QueueRecord = LocalQueueRecord<T>;
  let cache: QueueState<QueueRecord> | null = null;

  async function loadMessages(): Promise<QueueState<QueueRecord>> {
    if (cache) return cache;
    cache = await readJsonFile<QueueState<QueueRecord>>(queueFile, { messages: [] });
    return cache;
  }

  async function flushMessages(): Promise<void> {
    if (!cache) return;
    await writeJsonFile(queueFile, cache);
  }

  const queue = {
    queueName,
    sent: [] as QueueRecord[],
    async send(message: T, options?: unknown) {
      const messages = await loadMessages();
      const record = { body: message, options };
      messages.messages.push(record);
      queue.sent.push(record);
      await flushMessages();
    },
    async sendBatch(messages: Iterable<unknown>) {
      const persisted = await loadMessages();
      for (const message of messages) {
        const record = message as QueueRecord;
        persisted.messages.push(record);
        queue.sent.push(record);
      }
      await flushMessages();
    },
    async receive() {
      const persisted = await loadMessages();
      const record = persisted.messages.shift() ?? null;
      if (!record) return null;
      queue.sent.splice(0, queue.sent.length, ...persisted.messages);
      await flushMessages();
      return record;
    },
  };

  void loadMessages().then((messages) => {
    queue.sent.splice(0, queue.sent.length, ...messages.messages);
  });

  return queue as unknown as LocalQueue<T>;
}

export function createPersistentDurableObjectNamespace(
  stateFile: string,
  factory?: (id: string) => DurableObjectStub,
): InMemoryDurableObjectNamespace {
  type RegistryState = { ids: string[] };
  let registry: RegistryState | null = null;
  const namespaces = new Map<string, DurableObjectStub>();

  async function loadRegistry(): Promise<RegistryState> {
    if (registry) return registry;
    registry = await readJsonFile<RegistryState>(stateFile, { ids: [] });
    return registry;
  }

  async function flushRegistry(): Promise<void> {
    if (!registry) return;
    await writeJsonFile(stateFile, registry);
  }

  const namespace = createInMemoryDurableObjectNamespace((id) => {
    const existing = namespaces.get(id);
    if (existing) return existing;
    const stub = factory?.(id) ?? createInMemoryDurableObjectNamespace().getByName(id);
    namespaces.set(id, stub);
    return stub;
  });

  const originalGet = namespace.get.bind(namespace);
  namespace.get = (id: { toString(): string }) => {
    const key = id.toString();
    void loadRegistry().then((state) => {
      if (!state.ids.includes(key)) {
        state.ids.push(key);
        void flushRegistry();
      }
    });
    return originalGet(id as Parameters<typeof originalGet>[0]);
  };
  namespace.getByName = (name: string) => namespace.get(namespace.idFromName(name));

  void loadRegistry().then((state) => {
    for (const id of state.ids) {
      const stub = factory?.(id) ?? createInMemoryDurableObjectNamespace().getByName(id);
      namespaces.set(id, stub);
    }
  });

  return namespace as InMemoryDurableObjectNamespace;
}
