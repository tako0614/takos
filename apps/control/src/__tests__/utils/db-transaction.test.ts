import { describe, expect, it, vi } from 'vitest';
import {
  batchExecute,
  executeWithCompensation,
  D1TransactionManager,
  type TransactionStep,
} from '@/utils/db-transaction';

function createMockStatement(result?: unknown, shouldThrow = false) {
  return {
    run: shouldThrow
      ? vi.fn().mockRejectedValue(new Error('Statement failed'))
      : vi.fn().mockResolvedValue(result ?? { success: true, meta: { changes: 1, last_row_id: 1, duration: 0 } }),
  };
}

function createMockDb() {
  const executedStatements: string[] = [];
  return {
    batch: vi.fn().mockImplementation(async (stmts: any[]) => {
      return Promise.all(stmts.map((s: any) => s.run()));
    }),
    prepare: vi.fn().mockImplementation((sql: string) => {
      return {
        run: vi.fn().mockImplementation(async () => {
          executedStatements.push(sql);
          return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
        }),
      };
    }),
    _executed: executedStatements,
  };
}

describe('batchExecute', () => {
  it('returns success when all statements succeed', async () => {
    const stmt1 = createMockStatement({ success: true, results: [] });
    const stmt2 = createMockStatement({ success: true, results: [] });
    const db = { batch: vi.fn().mockResolvedValue([stmt1.run(), stmt2.run()]) } as any;

    const result = await batchExecute(db, [stmt1 as any, stmt2 as any]);
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.error).toBeUndefined();
  });

  it('returns failure when batch throws', async () => {
    const db = { batch: vi.fn().mockRejectedValue(new Error('batch failed')) } as any;
    const result = await batchExecute(db, []);
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toBe('batch failed');
  });

  it('handles non-Error exceptions', async () => {
    const db = { batch: vi.fn().mockRejectedValue('string error') } as any;
    const result = await batchExecute(db, []);
    expect(result.success).toBe(false);
    expect(result.error!.message).toBe('string error');
  });
});

describe('executeWithCompensation', () => {
  it('executes all steps successfully', async () => {
    const steps: TransactionStep[] = [
      { description: 'step 1', execute: createMockStatement() as any },
      { description: 'step 2', execute: createMockStatement() as any },
    ];

    const result = await executeWithCompensation({} as any, steps);
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.failedStep).toBeUndefined();
  });

  it('runs compensation actions in reverse on failure', async () => {
    const compensate1 = createMockStatement();
    const compensate2 = createMockStatement();

    const steps: TransactionStep[] = [
      { description: 'step 1', execute: createMockStatement() as any, compensate: compensate1 as any },
      { description: 'step 2', execute: createMockStatement() as any, compensate: compensate2 as any },
      { description: 'step 3', execute: createMockStatement(undefined, true) as any },
    ];

    const result = await executeWithCompensation({} as any, steps);
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe(2);
    expect(result.error!.message).toBe('Statement failed');
    // Both compensations should have been called (in reverse order)
    expect(compensate2.run).toHaveBeenCalled();
    expect(compensate1.run).toHaveBeenCalled();
  });

  it('reports compensation errors without suppressing main error', async () => {
    const failingCompensation = {
      run: vi.fn().mockRejectedValue(new Error('compensation failed')),
    };

    const steps: TransactionStep[] = [
      { description: 'step 1', execute: createMockStatement() as any, compensate: failingCompensation as any },
      { description: 'step 2', execute: createMockStatement(undefined, true) as any },
    ];

    const result = await executeWithCompensation({} as any, steps);
    expect(result.success).toBe(false);
    expect(result.compensationErrors).toHaveLength(1);
    expect(result.compensationErrors![0].message).toBe('compensation failed');
  });

  it('does not run compensation for steps without compensate handler', async () => {
    const steps: TransactionStep[] = [
      { description: 'step 1', execute: createMockStatement() as any },
      { description: 'step 2', execute: createMockStatement(undefined, true) as any },
    ];

    const result = await executeWithCompensation({} as any, steps);
    expect(result.success).toBe(false);
    expect(result.compensationErrors).toBeUndefined();
  });

  it('returns partial results up to the failed step', async () => {
    const steps: TransactionStep[] = [
      { description: 'step 1', execute: createMockStatement({ success: true, data: 'one' }) as any },
      { description: 'step 2', execute: createMockStatement(undefined, true) as any },
      { description: 'step 3', execute: createMockStatement() as any },
    ];

    const result = await executeWithCompensation({} as any, steps);
    expect(result.results).toHaveLength(1);
  });

  it('handles empty steps array', async () => {
    const result = await executeWithCompensation({} as any, []);
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(0);
  });
});

describe('D1TransactionManager', () => {
  it('wraps callback in BEGIN IMMEDIATE / COMMIT', async () => {
    const db = createMockDb();
    const txn = new D1TransactionManager(db as any);

    const result = await txn.runInTransaction(async () => 'hello');

    expect(result).toBe('hello');
    expect(db._executed).toContain('BEGIN IMMEDIATE');
    expect(db._executed).toContain('COMMIT');
  });

  it('rolls back on callback error', async () => {
    const db = createMockDb();
    const txn = new D1TransactionManager(db as any);

    await expect(
      txn.runInTransaction(async () => {
        throw new Error('callback failed');
      })
    ).rejects.toThrow('callback failed');

    expect(db._executed).toContain('BEGIN IMMEDIATE');
    expect(db._executed).toContain('ROLLBACK');
    expect(db._executed).not.toContain('COMMIT');
  });

  it('uses savepoints for nested transactions', async () => {
    const db = createMockDb();
    const txn = new D1TransactionManager(db as any);

    await txn.runInTransaction(async () => {
      await txn.runInTransaction(async () => 'inner');
      return 'outer';
    });

    expect(db._executed).toContain('BEGIN IMMEDIATE');
    expect(db._executed.some((s) => s.startsWith('SAVEPOINT'))).toBe(true);
    expect(db._executed.some((s) => s.startsWith('RELEASE SAVEPOINT'))).toBe(true);
    expect(db._executed).toContain('COMMIT');
  });

  it('rolls back savepoint on inner failure without aborting outer', async () => {
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

    expect(result).toBe('outer ok');
    expect(db._executed).toContain('COMMIT');
    expect(db._executed.some((s) => s.startsWith('ROLLBACK TO SAVEPOINT'))).toBe(true);
  });

  it('resets depth after transaction completes', async () => {
    const db = createMockDb();
    const txn = new D1TransactionManager(db as any);

    await txn.runInTransaction(async () => 'first');
    await txn.runInTransaction(async () => 'second');

    // Both should use BEGIN IMMEDIATE (not savepoints)
    const begins = db._executed.filter((s) => s === 'BEGIN IMMEDIATE');
    expect(begins).toHaveLength(2);
  });

  it('resets depth after failed transaction', async () => {
    const db = createMockDb();
    const txn = new D1TransactionManager(db as any);

    await expect(
      txn.runInTransaction(async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow();

    // Second transaction should still use BEGIN IMMEDIATE
    await txn.runInTransaction(async () => 'ok');
    const begins = db._executed.filter((s) => s === 'BEGIN IMMEDIATE');
    expect(begins).toHaveLength(2);
  });
});
