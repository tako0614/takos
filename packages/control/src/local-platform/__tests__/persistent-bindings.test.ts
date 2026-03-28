import { describe, expect, it, vi, beforeEach } from 'vitest';

type QueryRecord = {
  scope: 'pool' | 'client';
  sql: string;
  values?: unknown[];
};

function makeQueryResult(
  rows: Record<string, unknown>[] = [],
  rowCount = rows.length,
  command = 'SELECT',
) {
  return {
    rows,
    rowCount,
    command,
    oid: 0,
    fields: rows.length > 0
      ? Object.keys(rows[0]).map((name) => ({ name }))
      : [],
  };
}

function createMockPool() {
  const records: QueryRecord[] = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      records.push({ scope: 'client', sql, values });
      const normalized = sql.trim().replace(/\s+/g, ' ');
      if (/^SELECT 1 AS value/i.test(normalized)) {
        return makeQueryResult([{ value: 1 }]);
      }
      if (/^SELECT \* FROM demo/i.test(normalized)) {
        return makeQueryResult([{ id: 1, name: 'demo' }]);
      }
      if (/^INSERT /i.test(normalized)) {
        return makeQueryResult([], 1, 'INSERT');
      }
      if (/^UPDATE /i.test(normalized)) {
        return makeQueryResult([], 2, 'UPDATE');
      }
      if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(normalized)) {
        return makeQueryResult([], 0, normalized.split(' ', 1)[0].toUpperCase());
      }
      return makeQueryResult([]);
    }),
    release: vi.fn(),
  };

  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      records.push({ scope: 'pool', sql, values });
      const normalized = sql.trim().replace(/\s+/g, ' ');
      if (/^SELECT 1 AS value/i.test(normalized)) {
        return makeQueryResult([{ value: 1 }]);
      }
      if (/^SELECT \* FROM demo/i.test(normalized)) {
        return makeQueryResult([{ id: 1, name: 'demo' }]);
      }
      if (/^INSERT /i.test(normalized)) {
        return makeQueryResult([], 1, 'INSERT');
      }
      if (/^UPDATE /i.test(normalized)) {
        return makeQueryResult([], 2, 'UPDATE');
      }
      if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(normalized)) {
        return makeQueryResult([], 0, normalized.split(' ', 1)[0].toUpperCase());
      }
      return makeQueryResult([]);
    }),
    end: vi.fn(async () => undefined),
    records,
    client,
  };

  return pool;
}

const pgMockState = vi.hoisted(() => ({
  pool: null as ReturnType<typeof createMockPool> | null,
}));

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => {
    if (!pgMockState.pool) {
      throw new Error('pg mock pool not initialized');
    }
    return pgMockState.pool;
  }),
}));

import { createPostgresD1Database } from '../persistent-bindings.ts';

describe('createPostgresD1Database', () => {
  beforeEach(() => {
    pgMockState.pool = createMockPool();
  });

  it('supports prepare/bind/first/run/all/raw and withSession', async () => {
    const db = await createPostgresD1Database('postgresql://takos:takos@postgres:5432/takos');

    const stmt = db.prepare('SELECT * FROM demo WHERE id = $1').bind(7);
    await expect(stmt.first()).resolves.toEqual({ id: 1, name: 'demo' });
    await expect(stmt.first('name')).resolves.toBe('demo');
    await expect(stmt.run()).resolves.toMatchObject({
      success: true,
      results: [{ id: 1, name: 'demo' }],
      meta: expect.objectContaining({ served_by: 'local-postgres' }),
    });
    await expect(stmt.all()).resolves.toMatchObject({
      success: true,
      results: [{ id: 1, name: 'demo' }],
    });
    await expect(stmt.raw()).resolves.toEqual([[1, 'demo']]);
    await expect(stmt.raw({ columnNames: true })).resolves.toEqual([['id', 'name'], [1, 'demo']]);

    const session = db.withSession();
    expect(session.getBookmark()).toBeNull();
    await expect(session.batch([
      session.prepare('INSERT INTO demo (name) VALUES ($1)').bind('alpha'),
      session.prepare('UPDATE demo SET name = $1 WHERE id = $2').bind('beta', 1),
    ])).resolves.toHaveLength(2);

    await expect(
      db.prepare('INSERT INTO demo (id, name, note) VALUES (?, ?, null)').bind(9, 'gamma').run(),
    ).resolves.toMatchObject({
      success: true,
      meta: expect.objectContaining({ rows_written: 1 }),
    });

    const demoRecords = pgMockState.pool?.records.filter((record) =>
      record.sql.includes('demo') || record.sql === 'SELECT 1 AS value'
    );

    expect(demoRecords).toEqual([
      { scope: 'pool', sql: 'SELECT * FROM demo WHERE id = $1', values: [7] },
      { scope: 'pool', sql: 'SELECT * FROM demo WHERE id = $1', values: [7] },
      { scope: 'pool', sql: 'SELECT * FROM demo WHERE id = $1', values: [7] },
      { scope: 'pool', sql: 'SELECT * FROM demo WHERE id = $1', values: [7] },
      { scope: 'pool', sql: 'SELECT * FROM demo WHERE id = $1', values: [7] },
      { scope: 'pool', sql: 'SELECT * FROM demo WHERE id = $1', values: [7] },
      { scope: 'pool', sql: 'INSERT INTO demo (name) VALUES ($1)', values: ['alpha'] },
      { scope: 'pool', sql: 'UPDATE demo SET name = $1 WHERE id = $2', values: ['beta', 1] },
      { scope: 'pool', sql: 'INSERT INTO demo (id, name, note) VALUES ($1, $2, null)', values: [9, 'gamma'] },
    ]);

    await db.exec('SELECT 1 AS value');
    expect(pgMockState.pool?.records.at(-1)).toEqual({
      scope: 'pool',
      sql: 'SELECT 1 AS value',
      values: [],
    });

    db.close();
    expect(pgMockState.pool?.end).toHaveBeenCalledTimes(1);
  });

  it('normalizes BEGIN IMMEDIATE and pins transaction statements to one client', async () => {
    const db = await createPostgresD1Database('postgresql://takos:takos@postgres:5432/takos');

    await expect(db.prepare('BEGIN IMMEDIATE').run()).resolves.toMatchObject({ success: true });
    await expect(db.prepare('SELECT * FROM demo WHERE id = $1').bind(9).first()).resolves.toEqual({ id: 1, name: 'demo' });
    await expect(db.prepare('COMMIT').run()).resolves.toMatchObject({ success: true });

    expect(pgMockState.pool?.connect).toHaveBeenCalledTimes(1);
    expect(pgMockState.pool?.client.query).toHaveBeenNthCalledWith(1, 'BEGIN', []);
    expect(pgMockState.pool?.client.query).toHaveBeenNthCalledWith(2, 'SELECT * FROM demo WHERE id = $1', [9]);
    expect(pgMockState.pool?.client.query).toHaveBeenNthCalledWith(3, 'COMMIT', []);
    expect(pgMockState.pool?.client.release).toHaveBeenCalledTimes(1);
  });
});
