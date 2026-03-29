/**
 * Centralized environment validation for all worker entry points.
 *
 * Each worker declares its required bindings in REQUIRED_KEYS.  The generic
 * `validateEnv()` checks them; per-worker wrappers are kept for backward
 * compatibility but delegate to the generic function.
 */
/**
 * Validate that all `requiredKeys` are present (truthy) in `env`.
 * Returns `null` on success or a descriptive error string on failure.
 */
export declare function validateEnv(workerName: string, env: Record<string, unknown>, requiredKeys: readonly string[]): string | null;
export declare function validateWebEnv(env: Record<string, unknown>): string | null;
export declare function validateDispatchEnv(env: Record<string, unknown>): string | null;
export declare function validateRunnerEnv(env: Record<string, unknown>): string | null;
export declare function validateWorkflowRunnerEnv(env: Record<string, unknown>): string | null;
export declare function validateIndexerEnv(env: Record<string, unknown>): string | null;
export declare function validateEgressEnv(_env: Record<string, unknown>): string | null;
export declare function validateRuntimeHostEnv(env: Record<string, unknown>): string | null;
export declare function validateExecutorHostEnv(env: Record<string, unknown>): string | null;
/**
 * Wraps a validator into a cached first-request guard.  On first call it runs
 * the validator and logs any error; subsequent calls return the cached result.
 */
export declare function createEnvGuard(validator: (env: Record<string, unknown>) => string | null): (env: Record<string, unknown>) => string | null;
//# sourceMappingURL=validate-env.d.ts.map