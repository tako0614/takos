import { createClient } from '@libsql/client';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import type { D1PreparedStatement } from '../shared/types/bindings.ts';
import { classifyTransactionSql, isExactTransactionControlSql, normalizePostgresSql, type ServerD1Database } from './d1-shared.ts';
import { logWarn } from '../shared/utils/logger.ts';
import {
  ensurePostgresAccountsTableShape,
  ensurePostgresServicesTableShape,
  ensureServerMigrations,
  ensureServerPostgresMigrations,
  ensureSqliteAccountsTableShape,
  ensureSqliteServicesTableShape,
} from './d1-migrations.ts';
import { createPostgresPreparedStatement, createPreparedStatement, createSequentialBatch } from './d1-prepared-statement.ts';
import { ensureParentDirectory } from './persistent-shared.ts';

export { splitSqlStatements } from './d1-sql-rewrite.ts';
export type { ServerD1Database } from './d1-shared.ts';

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
          await client.query('ROLLBACK').catch((e) => {
            logWarn('ROLLBACK failed after transaction error (non-critical)', { module: 'persistent-d1', error: e instanceof Error ? e.message : String(e) });
          });
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
