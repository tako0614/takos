import {
  batchExecute,
  executeWithCompensation,
  D1TransactionManager,
  type TransactionStep,
} from '@/utils/db-transaction';

import { assertEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';

function createMockStatement(result?: unknown, shouldThrow = false) {
  return {
    run: shouldThrow
      ? (async () => { throw new Error('Statement failed'); })
      : (async () => result ?? { success: true, meta: { changes: 1, last_row_id: 1, duration: 0 } }),
  };
}

function createMockDb() {
  const executedStatements: string[] = [];
  return {
    batch: async (stmts: any[]) => {
      return Promise.all(stmts.map((s: any) => s.run()));
    },
    prepare: (sql: string) => {
      return {
        run: async () => {
          executedStatements.push(sql);
          return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
        },
      };
    },
    _executed: executedStatements,
  };
}


  Deno.test('batchExecute - returns success when all statements succeed', async () => {
  const stmt1 = createMockStatement({ success: true, results: [] });
    const stmt2 = createMockStatement({ success: true, results: [] });
    const db = { batch: (async () => [stmt1.run(), stmt2.run()]) } as any;

    const result = await batchExecute(db, [stmt1 as any, stmt2 as any]);
    assertEquals(result.success, true);
    assertEquals(result.results.length, 2);
    assertEquals(result.error, undefined);
})
  Deno.test('batchExecute - returns failure when batch throws', async () => {
  const db = { batch: (async () => { throw new Error('batch failed'); }) } as any;
    const result = await batchExecute(db, []);
    assertEquals(result.success, false);
    assert(result.error instanceof Error);
    assertEquals(result.error!.message, 'batch failed');
})
  Deno.test('batchExecute - handles non-Error exceptions', async () => {
  const db = { batch: (async () => { throw 'string error'; }) } as any;
    const result = await batchExecute(db, []);
    assertEquals(result.success, false);
    assertEquals(result.error!.message, 'string error');
})

  Deno.test('executeWithCompensation - executes all steps successfully', async () => {
  const steps: TransactionStep[] = [
      { description: 'step 1', execute: createMockStatement() as any },
      { description: 'step 2', execute: createMockStatement() as any },
    ];

    const result = await executeWithCompensation({} as any, steps);
    assertEquals(result.success, true);
    assertEquals(result.results.length, 2);
    assertEquals(result.failedStep, undefined);
})
  Deno.test('executeWithCompensation - runs compensation actions in reverse on failure', async () => {
  const compensate1 = createMockStatement();
    const compensate2 = createMockStatement();

    const steps: TransactionStep[] = [
      { description: 'step 1', execute: createMockStatement() as any, compensate: compensate1 as any },
      { description: 'step 2', execute: createMockStatement() as any, compensate: compensate2 as any },
      { description: 'step 3', execute: createMockStatement(undefined, true) as any },
    ];

    const result = await executeWithCompensation({} as any, steps);
    assertEquals(result.success, false);
    assertEquals(result.failedStep, 2);
    assertEquals(result.error!.message, 'Statement failed');
    // Both compensations should have been called (in reverse order)
    assert(compensate2.run.calls.length > 0);
    assert(compensate1.run.calls.length > 0);
})
  Deno.test('executeWithCompensation - reports compensation errors without suppressing main error', async () => {
  const failingCompensation = {
      run: (async () => { throw new Error('compensation failed'); }),
    };

    const steps: TransactionStep[] = [
      { description: 'step 1', execute: createMockStatement() as any, compensate: failingCompensation as any },
      { description: 'step 2', execute: createMockStatement(undefined, true) as any },
    ];

    const result = await executeWithCompensation({} as any, steps);
    assertEquals(result.success, false);
    assertEquals(result.compensationErrors.length, 1);
    assertEquals(result.compensationErrors![0].message, 'compensation failed');
})
  Deno.test('executeWithCompensation - does not run compensation for steps without compensate handler', async () => {
  const steps: TransactionStep[] = [
      { description: 'step 1', execute: createMockStatement() as any },
      { description: 'step 2', execute: createMockStatement(undefined, true) as any },
    ];

    const result = await executeWithCompensation({} as any, steps);
    assertEquals(result.success, false);
    assertEquals(result.compensationErrors, undefined);
})
  Deno.test('executeWithCompensation - returns partial results up to the failed step', async () => {
  const steps: TransactionStep[] = [
      { description: 'step 1', execute: createMockStatement({ success: true, data: 'one' }) as any },
      { description: 'step 2', execute: createMockStatement(undefined, true) as any },
      { description: 'step 3', execute: createMockStatement() as any },
    ];

    const result = await executeWithCompensation({} as any, steps);
    assertEquals(result.results.length, 1);
})
  Deno.test('executeWithCompensation - handles empty steps array', async () => {
  const result = await executeWithCompensation({} as any, []);
    assertEquals(result.success, true);
    assertEquals(result.results.length, 0);
})

  Deno.test('D1TransactionManager - wraps callback in BEGIN IMMEDIATE / COMMIT', async () => {
  const db = createMockDb();
    const txn = new D1TransactionManager(db as any);

    const result = await txn.runInTransaction(async () => 'hello');

    assertEquals(result, 'hello');
    assertStringIncludes(db._executed, 'BEGIN IMMEDIATE');
    assertStringIncludes(db._executed, 'COMMIT');
})
  Deno.test('D1TransactionManager - rolls back on callback error', async () => {
  const db = createMockDb();
    const txn = new D1TransactionManager(db as any);

    await await assertRejects(async () => { await 
      txn.runInTransaction(async () => {
        throw new Error('callback failed');
      })
    ; }, 'callback failed');

    assertStringIncludes(db._executed, 'BEGIN IMMEDIATE');
    assertStringIncludes(db._executed, 'ROLLBACK');
    assert(!(db._executed).includes('COMMIT'));
})
  Deno.test('D1TransactionManager - uses savepoints for nested transactions', async () => {
  const db = createMockDb();
    const txn = new D1TransactionManager(db as any);

    await txn.runInTransaction(async () => {
      await txn.runInTransaction(async () => 'inner');
      return 'outer';
    });

    assertStringIncludes(db._executed, 'BEGIN IMMEDIATE');
    assertEquals(db._executed.some((s) => s.startsWith('SAVEPOINT')), true);
    assertEquals(db._executed.some((s) => s.startsWith('RELEASE SAVEPOINT')), true);
    assertStringIncludes(db._executed, 'COMMIT');
})
  Deno.test('D1TransactionManager - rolls back savepoint on inner failure without aborting outer', async () => {
  const db = createMockDb();
    const txn = new D1TransactionManager(db as any);

    const result = await txn.runInTransaction(async () => {
      try {
        await txn.runInTransaction(async () => {
          throw new Error('inner failed');
        });
      } catch {
        // swallow inner error
      }
      return 'outer ok';
    });

    assertEquals(result, 'outer ok');
    assertStringIncludes(db._executed, 'COMMIT');
    assertEquals(db._executed.some((s) => s.startsWith('ROLLBACK TO SAVEPOINT')), true);
})
  Deno.test('D1TransactionManager - resets depth after transaction completes', async () => {
  const db = createMockDb();
    const txn = new D1TransactionManager(db as any);

    await txn.runInTransaction(async () => 'first');
    await txn.runInTransaction(async () => 'second');

    // Both should use BEGIN IMMEDIATE (not savepoints)
    const begins = db._executed.filter((s) => s === 'BEGIN IMMEDIATE');
    assertEquals(begins.length, 2);
})
  Deno.test('D1TransactionManager - resets depth after failed transaction', async () => {
  const db = createMockDb();
    const txn = new D1TransactionManager(db as any);

    await await assertRejects(async () => { await 
      txn.runInTransaction(async () => {
        throw new Error('fail');
      })
    ; });

    // Second transaction should still use BEGIN IMMEDIATE
    await txn.runInTransaction(async () => 'ok');
    const begins = db._executed.filter((s) => s === 'BEGIN IMMEDIATE');
    assertEquals(begins.length, 2);
})