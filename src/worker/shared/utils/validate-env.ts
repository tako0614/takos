import { logError } from "./logger.ts";

/**
 * Centralized environment validation for all service entry points.
 *
 * Each service declares its required bindings in REQUIRED_KEYS.  The generic
 * `validateEnv()` checks them; per-service wrappers keep entry points explicit
 * while delegating to the generic function.
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
  env: object,
  requiredKeys: readonly string[],
): string | null {
  const missing = requiredKeys.filter((k) => !Reflect.get(env, k));
  if (missing.length === 0) return null;
  return `[${workerName}] Missing required environment bindings: ${missing.join(
    ", ",
  )}`;
}

// ---------------------------------------------------------------------------
// Per-service required keys
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = {
  takos: [
    "DB",
    "HOSTNAME_ROUTING",
    "SESSION_DO",
    "RUN_NOTIFIER",
    "RUN_QUEUE",
    "OIDC_ISSUER_URL",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "ADMIN_DOMAIN",
    "TENANT_BASE_DOMAIN",
    "PLATFORM_PRIVATE_KEY",
    "PLATFORM_PUBLIC_KEY",
    // Shared secret carried into the in-process container-host env
    // (withUnifiedContainerHostEnv); kept required so the executor-host env
    // shape stays populated at boot.
    "EXECUTOR_PROXY_SECRET",
    // Required at runtime by common-env crypto helpers (`getCommonEnvSecret`
    // throws if unset). Fail fast at boot rather than deferring to first use.
    "ENCRYPTION_KEY",
  ],
  "takos-worker": ["DB", "RUN_QUEUE", "RUN_NOTIFIER"],
  "takos-workflow-runner": ["DB"],
  "takos-indexer": ["DB"],
  "takos-runtime-host": ["RUNTIME_CONTAINER", "PLATFORM_PUBLIC_KEY"],
  "takos-executor-host": [
    "EXECUTOR_CONTAINER",
    "TAKOS_AGENT_CONTROL_RPC_BASE_URL",
    "EXECUTOR_PROXY_SECRET",
  ],
} as const;

// ---------------------------------------------------------------------------
// Per-service validators
// ---------------------------------------------------------------------------

export function validateWebEnv(env: object): string | null {
  return validateEnv("takos", env, REQUIRED_KEYS["takos"]);
}

export function validateDispatchEnv(env: object): string | null {
  // Custom logic: HOSTNAME_ROUTING and ROUTING_STORE are alternatives.
  const missing = ["DISPATCHER", "ADMIN_DOMAIN"].filter(
    (k) => !Reflect.get(env, k),
  );
  if (
    !Reflect.get(env, "HOSTNAME_ROUTING") &&
    !Reflect.get(env, "ROUTING_STORE")
  ) {
    missing.push("HOSTNAME_ROUTING|ROUTING_STORE");
  }
  if (missing.length === 0) return null;
  return `[takos-dispatch] Missing required environment bindings: ${missing.join(
    ", ",
  )}`;
}

export function validateRunnerEnv(env: object): string | null {
  return validateEnv("takos-worker", env, REQUIRED_KEYS["takos-worker"]);
}

export function validateWorkflowRunnerEnv(env: object): string | null {
  return validateEnv(
    "takos-workflow-runner",
    env,
    REQUIRED_KEYS["takos-workflow-runner"],
  );
}

export function validateIndexerEnv(env: object): string | null {
  return validateEnv("takos-indexer", env, REQUIRED_KEYS["takos-indexer"]);
}

export function validateRuntimeHostEnv(env: object): string | null {
  const missing = validateEnv(
    "takos-runtime-host",
    env,
    REQUIRED_KEYS["takos-runtime-host"],
  );
  if (missing) return missing;
  if (Reflect.get(env, "JWT_PUBLIC_KEY")) {
    return "[takos-runtime-host] JWT_PUBLIC_KEY is not a supported runtime-host input; set PLATFORM_PUBLIC_KEY instead";
  }
  return null;
}

export function validateExecutorHostEnv(env: object): string | null {
  return validateEnv(
    "takos-executor-host",
    env,
    REQUIRED_KEYS["takos-executor-host"],
  );
}

// ---------------------------------------------------------------------------
// Shared startup guard
// ---------------------------------------------------------------------------

/**
 * Wraps a validator into a cached first-request guard.  On first call it runs
 * the validator and logs any error; subsequent calls return the cached result.
 */
export function createEnvGuard(
  validator: (env: object) => string | null,
): (env: object) => string | null {
  let cachedError: string | null | undefined;

  return (env: object): string | null => {
    if (cachedError === undefined) {
      cachedError = validator(env);
      if (cachedError) {
        logError(`Environment validation failed: ${cachedError}`, undefined, {
          module: "startup",
        });
      }
    }
    return cachedError ?? null;
  };
}
