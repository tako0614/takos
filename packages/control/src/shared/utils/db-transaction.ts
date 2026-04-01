import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
} from '../types/bindings.ts';
import { logError } from './logger.ts';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface BatchResult {
  success: boolean;
  results: SqlResultBinding[];
  error?: Error;
}

export async function batchExecute(
  _db: SqlDatabaseBinding,
  statements: SqlPreparedStatementBinding[]
): Promise<BatchResult> {
  try {
    const results = await _db.batch(statements);
    return { success: true, results };
  } catch (error) {
    return { success: false, results: [], error: toError(error) };
  }
}

export interface CompensationAction {
  description: string;
  statement: SqlPreparedStatementBinding;
}

export interface TransactionStep {
  description: string;
  execute: SqlPreparedStatementBinding;
  compensate?: SqlPreparedStatementBinding;
}

export interface CompensationResult<TResult> {
  success: boolean;
  results: TResult[];
  failedStep?: number;
  error?: Error;
  compensationErrors?: Error[];
}

/**
 * Execute D1 steps sequentially with manual compensation on failure.
 * Each step's compensate statement is run in reverse order if a later step fails.
 */
export async function executeWithCompensation(
  _db: SqlDatabaseBinding,
  steps: TransactionStep[]
): Promise<CompensationResult<SqlResultBinding>> {
  const results: SqlResultBinding[] = [];
  const completedCompensations: SqlPreparedStatementBinding[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    try {
      const result = await step.execute.run();
      results.push(result);

      if (step.compensate) {
        completedCompensations.unshift(step.compensate);
      }
    } catch (error) {
      logError(`Transaction step ${i} (${step.description}) failed`, error, { module: 'utils/db-transaction' });

      const compensationErrors: Error[] = [];
      for (const compensation of completedCompensations) {
        try {
          await compensation.run();
        } catch (compError) {
          logError('Compensation failed', compError, { module: 'utils/db-transaction' });
          compensationErrors.push(toError(compError));
        }
      }

      return {
        success: false,
        results,
        failedStep: i,
        error: toError(error),
        compensationErrors: compensationErrors.length > 0 ? compensationErrors : undefined,
      };
    }
  }

  return { success: true, results };
}

/**
 * Manages nested D1 transactions using savepoints.
 *
 * The first call to `runInTransaction` opens a real transaction (BEGIN IMMEDIATE).
 * Nested calls create savepoints so that inner failures roll back only the
 * inner scope. Transaction depth is tracked in a try/finally block to ensure
 * consistent state even when the callback throws.
 */
export class D1TransactionManager {
  private transactionDepth = 0;
  private savepointSeq = 0;

  constructor(private db: SqlDatabaseBinding) {}

  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.transactionDepth === 0) {
      this.transactionDepth += 1;
      await this.db.prepare('BEGIN IMMEDIATE').run();
      try {
        const result = await fn();
        await this.db.prepare('COMMIT').run();
        return result;
      } catch (error) {
        try {
          await this.db.prepare('ROLLBACK').run();
        } catch {
          // Ignore rollback failures and rethrow the original error.
        }
        throw error;
      } finally {
        this.transactionDepth -= 1;
      }
    }

    const savepointName = `sp_${++this.savepointSeq}`;
    this.transactionDepth += 1;
    await this.db.prepare(`SAVEPOINT ${savepointName}`).run();
    try {
      const result = await fn();
      await this.db.prepare(`RELEASE SAVEPOINT ${savepointName}`).run();
      return result;
    } catch (error) {
      try {
        await this.db.prepare(`ROLLBACK TO SAVEPOINT ${savepointName}`).run();
        await this.db.prepare(`RELEASE SAVEPOINT ${savepointName}`).run();
      } catch {
        // Ignore rollback failures and rethrow the original error.
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }
}
