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

/**
 * Boot-required bindings by service.
 *
 * This is not the same set as `REQUIRED_RUNTIME_SECRET_NAMES`: a secret can be
 * required of a deployment without being required at boot. Every difference is
 * named, with its reason, in `RUNTIME_SECRETS_NOT_REQUIRED_AT_BOOT`, and
 * `runtime-secrets.test.ts` refuses an unnamed one.
 */
const REQUIRED_KEYS = {
  takos: [
    "DB",
    "HOSTNAME_ROUTING",
    "SESSION_DO",
    "RUN_NOTIFIER",
    "RUN_QUEUE",
    "OIDC_ISSUER_URL",
    "OIDC_CLIENT_ID",
    "ADMIN_DOMAIN",
    "TENANT_BASE_DOMAIN",
    "PLATFORM_PRIVATE_KEY",
    "PLATFORM_PUBLIC_KEY",
    // Private executor-host -> agent-container /start bearer credential.
    "TAKOS_AGENT_START_TOKEN",
    // Required at runtime by common-env crypto helpers (`getCommonEnvSecret`
    // throws if unset). Fail fast at boot rather than deferring to first use.
    "ENCRYPTION_KEY",
  ],
  "takos-worker": ["DB", "RUN_QUEUE", "RUN_NOTIFIER"],
  "takos-indexer": ["DB"],
  "takos-executor-host": [
    "EXECUTOR_CONTAINER",
    "TAKOS_AGENT_CONTROL_RPC_BASE_URL",
    "TAKOS_AGENT_START_TOKEN",
  ],
} as const;

// ---------------------------------------------------------------------------
// Per-service validators
// ---------------------------------------------------------------------------

/** The exact boot-required bindings for one service, for cross-checking. */
export function requiredEnvKeys(
  service: keyof typeof REQUIRED_KEYS,
): readonly string[] {
  return REQUIRED_KEYS[service];
}

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

export function validateIndexerEnv(env: object): string | null {
  return validateEnv("takos-indexer", env, REQUIRED_KEYS["takos-indexer"]);
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
