import type { D1Database } from '../../shared/types/bindings.ts';
/**
 * Generate a deterministic operation key for a tool call.
 * Key = SHA-256(runId + toolName + JSON.stringify(sortKeys(args))) truncated to 32 hex chars.
 */
export declare function generateOperationKey(runId: string, toolName: string, args: Record<string, unknown>): Promise<string>;
export interface IdempotencyResult {
    /** 'execute' = proceed with execution, 'cached' = return cached result, 'in_progress' = another execution is running */
    action: 'execute' | 'cached' | 'in_progress';
    cachedOutput?: string;
    cachedError?: string;
    operationId?: string;
}
/**
 * Check idempotency guard before executing a side-effect tool.
 * Returns whether to execute, use cached result, or wait.
 */
export declare function checkIdempotency(db: D1Database, runId: string, toolName: string, args: Record<string, unknown>): Promise<IdempotencyResult>;
/**
 * Mark an operation as completed with its result.
 */
export declare function completeOperation(db: D1Database, operationId: string, output: string, error?: string): Promise<void>;
/**
 * Clean up old tool operations for terminal runs.
 * Called by cron handler.
 */
export declare function cleanupStaleOperations(db: D1Database): Promise<number>;
//# sourceMappingURL=idempotency.d.ts.map