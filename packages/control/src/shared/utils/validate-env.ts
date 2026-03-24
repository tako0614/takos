import { logError } from './logger';
/**
 * Centralized environment validation for all worker entry points.
 *
 * Each worker has a dedicated validator that checks for the bindings it needs.
 * Validators return null on success or a descriptive error string listing all
 * missing bindings on failure.
 */

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function findMissing(env: Record<string, unknown>, keys: string[]): string[] {
  const missing: string[] = [];
  for (const key of keys) {
    if (!env[key]) {
      missing.push(key);
    }
  }
  return missing;
}

function formatError(workerName: string, missing: string[]): string | null {
  if (missing.length === 0) return null;
  return `[${workerName}] Missing required environment bindings: ${missing.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Web Worker (src/web.ts)
// ---------------------------------------------------------------------------

export function validateWebEnv(env: Record<string, unknown>): string | null {
  const required = [
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
  ];
  return formatError('takos-web', findMissing(env, required));
}

// ---------------------------------------------------------------------------
// Dispatch Worker (src/dispatch.ts)
// ---------------------------------------------------------------------------

export function validateDispatchEnv(env: Record<string, unknown>): string | null {
  const missing = findMissing(env, ['DISPATCHER', 'ADMIN_DOMAIN']);
  if (!env.HOSTNAME_ROUTING && !env.ROUTING_STORE) {
    missing.push('HOSTNAME_ROUTING|ROUTING_STORE');
  }
  return formatError('takos-dispatch', missing);
}

// ---------------------------------------------------------------------------
// Runner Worker (src/runtime/runner/index.ts)
// ---------------------------------------------------------------------------

export function validateRunnerEnv(env: Record<string, unknown>): string | null {
  const required = [
    'DB',
    'RUN_QUEUE',
    'RUN_NOTIFIER',
    'EXECUTOR_HOST',
  ];
  return formatError('takos-runner', findMissing(env, required));
}

// ---------------------------------------------------------------------------
// Workflow Runner Worker (src/runtime/queues/workflow-runner.ts)
// ---------------------------------------------------------------------------

export function validateWorkflowRunnerEnv(env: Record<string, unknown>): string | null {
  const required = [
    'DB',
  ];
  return formatError('takos-workflow-runner', findMissing(env, required));
}

// ---------------------------------------------------------------------------
// Indexer Worker (src/runtime/indexer/index.ts)
// ---------------------------------------------------------------------------

export function validateIndexerEnv(env: Record<string, unknown>): string | null {
  const required = [
    'DB',
  ];
  return formatError('takos-indexer', findMissing(env, required));
}

// ---------------------------------------------------------------------------
// Egress Worker (src/runtime/worker/egress.ts)
// ---------------------------------------------------------------------------

export function validateEgressEnv(env: Record<string, unknown>): string | null {
  // Egress has no strictly required bindings; RATE_LIMITER_DO is optional.
  // Validation is a no-op for now but provides a consistent hook.
  return null;
}

// ---------------------------------------------------------------------------
// Runtime Host Worker (src/runtime/container-hosts/runtime-host.ts)
// ---------------------------------------------------------------------------

export function validateRuntimeHostEnv(env: Record<string, unknown>): string | null {
  const required = [
    'RUNTIME_CONTAINER',
  ];
  return formatError('takos-runtime-host', findMissing(env, required));
}

// ---------------------------------------------------------------------------
// Executor Host Worker (src/runtime/container-hosts/executor-host.ts)
// ---------------------------------------------------------------------------

export function validateExecutorHostEnv(env: Record<string, unknown>): string | null {
  const required = [
    'EXECUTOR_CONTAINER',
    'DB',
    'RUN_NOTIFIER',
    'TAKOS_OFFLOAD',
    'TAKOS_EGRESS',
    'CONTROL_RPC_BASE_URL',
  ];
  return formatError('takos-executor-host', findMissing(env, required));
}

// ---------------------------------------------------------------------------
// Shared startup guard
// ---------------------------------------------------------------------------

/**
 * Wraps a validator into a cached first-request guard suitable for use in
 * a worker's `fetch()` handler.  Returns a function that, on first call,
 * runs the validator and logs any error.  Subsequent calls return the
 * cached result without re-running validation.
 *
 * Usage:
 *   const guard = createEnvGuard(validateWebEnv);
 *
 *   export default {
 *     async fetch(request, env) {
 *       const error = guard(env);
 *       if (error) { ... return 503 ... }
 *       ...
 *     }
 *   };
 */
export function createEnvGuard(
  validator: (env: Record<string, unknown>) => string | null,
): (env: Record<string, unknown>) => string | null {
  let validated = false;
  let cachedError: string | null = null;

  return (env: Record<string, unknown>): string | null => {
    if (!validated) {
      cachedError = validator(env);
      validated = true;
      if (cachedError) {
        logError(`Environment validation failed: ${cachedError}`, undefined, { module: 'startup' });
      }
    }
    return cachedError;
  };
}
