import { logError } from './logger.ts';

/**
 * Centralized environment validation for all worker entry points.
 *
 * Each worker declares its required bindings in REQUIRED_KEYS.  The generic
 * `validateEnv()` checks them; per-worker wrappers are kept for backward
 * compatibility but delegate to the generic function.
 */

// ---------------------------------------------------------------------------
// Generic validator
// ---------------------------------------------------------------------------

/**
 * Validate that all `requiredKeys` are present (truthy) in `env`.
 * Returns `null` on success or a descriptive error string on failure.
 */
export function validateEnv(
  workerName: string,
  env: Record<string, unknown>,
  requiredKeys: readonly string[],
): string | null {
  const missing = requiredKeys.filter((k) => !env[k]);
  if (missing.length === 0) return null;
  return `[${workerName}] Missing required environment bindings: ${missing.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Per-worker required keys
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = {
  'takos-web': [
    'DB',
    'HOSTNAME_ROUTING',
    'SESSION_DO',
    'RUN_NOTIFIER',
    'RUN_QUEUE',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'ADMIN_DOMAIN',
    'TENANT_BASE_DOMAIN',
    'PLATFORM_PRIVATE_KEY',
    'PLATFORM_PUBLIC_KEY',
    // Required at runtime by common-env crypto helpers (`getCommonEnvSecret`
    // throws if unset). Fail fast at boot rather than deferring to first use.
    'ENCRYPTION_KEY',
  ],
  'takos-runner': ['DB', 'RUN_QUEUE', 'RUN_NOTIFIER'],
  'takos-workflow-runner': ['DB'],
  'takos-indexer': ['DB'],
  'takos-runtime-host': ['RUNTIME_CONTAINER'],
  'takos-executor-host': [
    'EXECUTOR_CONTAINER',
    'DB',
    'RUN_NOTIFIER',
    'TAKOS_OFFLOAD',
    'TAKOS_EGRESS',
    'CONTROL_RPC_BASE_URL',
  ],
} as const;

// ---------------------------------------------------------------------------
// Per-worker validators (backward-compatible wrappers)
// ---------------------------------------------------------------------------

export function validateWebEnv(env: Record<string, unknown>): string | null {
  return validateEnv('takos-web', env, REQUIRED_KEYS['takos-web']);
}

export function validateDispatchEnv(env: Record<string, unknown>): string | null {
  // Custom logic: HOSTNAME_ROUTING and ROUTING_STORE are alternatives.
  const missing = ['DISPATCHER', 'ADMIN_DOMAIN'].filter((k) => !env[k]);
  if (!env.HOSTNAME_ROUTING && !env.ROUTING_STORE) {
    missing.push('HOSTNAME_ROUTING|ROUTING_STORE');
  }
  if (missing.length === 0) return null;
  return `[takos-dispatch] Missing required environment bindings: ${missing.join(', ')}`;
}

export function validateRunnerEnv(env: Record<string, unknown>): string | null {
  return validateEnv('takos-runner', env, REQUIRED_KEYS['takos-runner']);
}

export function validateWorkflowRunnerEnv(env: Record<string, unknown>): string | null {
  return validateEnv('takos-workflow-runner', env, REQUIRED_KEYS['takos-workflow-runner']);
}

export function validateIndexerEnv(env: Record<string, unknown>): string | null {
  return validateEnv('takos-indexer', env, REQUIRED_KEYS['takos-indexer']);
}

export function validateEgressEnv(_env: Record<string, unknown>): string | null {
  // Egress has no required bindings; validation is a no-op.
  return null;
}

export function validateRuntimeHostEnv(env: Record<string, unknown>): string | null {
  return validateEnv('takos-runtime-host', env, REQUIRED_KEYS['takos-runtime-host']);
}

export function validateExecutorHostEnv(env: Record<string, unknown>): string | null {
  return validateEnv('takos-executor-host', env, REQUIRED_KEYS['takos-executor-host']);
}

// ---------------------------------------------------------------------------
// Shared startup guard
// ---------------------------------------------------------------------------

/**
 * Wraps a validator into a cached first-request guard.  On first call it runs
 * the validator and logs any error; subsequent calls return the cached result.
 */
export function createEnvGuard(
  validator: (env: Record<string, unknown>) => string | null,
): (env: Record<string, unknown>) => string | null {
  let cachedError: string | null | undefined;

  return (env: Record<string, unknown>): string | null => {
    if (cachedError === undefined) {
      cachedError = validator(env);
      if (cachedError) {
        logError(`Environment validation failed: ${cachedError}`, undefined, { module: 'startup' });
      }
    }
    return cachedError ?? null;
  };
}
