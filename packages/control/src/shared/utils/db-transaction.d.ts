import type { SqlDatabaseBinding, SqlPreparedStatementBinding, SqlResultBinding } from '../types/bindings.ts';
export interface BatchResult {
    success: boolean;
    results: SqlResultBinding[];
    error?: Error;
}
export declare function batchExecute(db: SqlDatabaseBinding, statements: SqlPreparedStatementBinding[]): Promise<BatchResult>;
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
export declare function executeWithCompensation(db: SqlDatabaseBinding, steps: TransactionStep[]): Promise<CompensationResult<SqlResultBinding>>;
/**
 * Manages nested D1 transactions using savepoints.
 *
 * The first call to `runInTransaction` opens a real transaction (BEGIN IMMEDIATE).
 * Nested calls create savepoints so that inner failures roll back only the
 * inner scope. Transaction depth is tracked in a try/finally block to ensure
 * consistent state even when the callback throws.
 */
export declare class D1TransactionManager {
    private db;
    private transactionDepth;
    private savepointSeq;
    constructor(db: SqlDatabaseBinding);
    runInTransaction<T>(fn: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=db-transaction.d.ts.map