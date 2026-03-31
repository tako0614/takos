type QueryRecord = {
import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

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
    query: async (sql: string, values?: unknown[]) => {
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
    },
    release: ((..._args: any[]) => undefined) as any,
  };

  const pool = {
    connect: async () => client,
    query: async (sql: string, values?: unknown[]) => {
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
    },
    end: async () => undefined,
    records,
    client,
  };

  return pool;
}

const pgMockState = ({
  pool: null as ReturnType<typeof createMockPool> | null,
});

// [Deno] vi.mock removed - manually stub imports from 'pg'
import { createPostgresD1Database } from '../persistent-bindings.ts';


  Deno.test('createPostgresD1Database - supports prepare/bind/first/run/all/raw and withSession', async () => {
  pgMockState.pool = createMockPool();
  const db = await createPostgresD1Database('postgresql://takos:takos@postgres:5432/takos');

    const stmt = db.prepare('SELECT * FROM demo WHERE id = $1').bind(7);
    await assertEquals(await stmt.first(), { id: 1, name: 'demo' });
    await assertEquals(await stmt.first('name'), 'demo');
    await assertObjectMatch(await stmt.run(), {
      success: true,
      results: [{ id: 1, name: 'demo' }],
      meta: ({ served_by: 'local-postgres' }),
    });
    await assertObjectMatch(await stmt.all(), {
      success: true,
      results: [{ id: 1, name: 'demo' }],
    });
    await assertEquals(await stmt.raw(), [[1, 'demo']]);
    await assertEquals(await stmt.raw({ columnNames: true }), [['id', 'name'], [1, 'demo']]);

    const session = db.withSession();
    assertEquals(session.getBookmark(), null);
    await assertEquals((await session.batch([
      session.prepare('INSERT INTO demo (name) VALUES ($1)').bind('alpha'),
      session.prepare('UPDATE demo SET name = $1 WHERE id = $2').bind('beta', 1),
    ])).length, 2);

    await assertObjectMatch(await 
      db.prepare('INSERT INTO demo (id, name, note) VALUES (?, ?, null)').bind(9, 'gamma').run(),
    , {
      success: true,
      meta: ({ rows_written: 1 }),
    });

    const demoRecords = pgMockState.pool?.records.filter((record) =>
      record.sql.includes('demo') || record.sql === 'SELECT 1 AS value'
    );

    assertEquals(demoRecords, [
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
    assertEquals(pgMockState.pool?.records.at(-1), {
      scope: 'pool',
      sql: 'SELECT 1 AS value',
      values: [],
    });

    db.close();
    assertSpyCalls(pgMockState.pool?.end, 1);
})
  Deno.test('createPostgresD1Database - normalizes BEGIN IMMEDIATE and pins transaction statements to one client', async () => {
  pgMockState.pool = createMockPool();
  const db = await createPostgresD1Database('postgresql://takos:takos@postgres:5432/takos');

    await assertObjectMatch(await db.prepare('BEGIN IMMEDIATE').run(), { success: true });
    await assertEquals(await db.prepare('SELECT * FROM demo WHERE id = $1').bind(9).first(), { id: 1, name: 'demo' });
    await assertObjectMatch(await db.prepare('COMMIT').run(), { success: true });

    assertSpyCalls(pgMockState.pool?.connect, 1);
    assertSpyCallArgs(pgMockState.pool?.client.query, 0, ['BEGIN', []]);
    assertSpyCallArgs(pgMockState.pool?.client.query, 1, ['SELECT * FROM demo WHERE id = $1', [9]]);
    assertSpyCallArgs(pgMockState.pool?.client.query, 2, ['COMMIT', []]);
    assertSpyCalls(pgMockState.pool?.client.release, 1);
})