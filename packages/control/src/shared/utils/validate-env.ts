import { logError } from "./logger.ts";

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
  env: object,
  requiredKeys: readonly string[],
): string | null {
  const missing = requiredKeys.filter((k) => !Reflect.get(env, k));
  if (missing.length === 0) return null;
  return `[${workerName}] Missing required environment bindings: ${
    missing.join(", ")
  }`;
}

function optionalString(env: object, key: string): string {
  const value = Reflect.get(env, key);
  return typeof value === "string" ? value : "";
}

function normalizeKeyForCompare(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

// ---------------------------------------------------------------------------
// Per-worker required keys
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = {
  "takos": [
    "DB",
    "HOSTNAME_ROUTING",
    "SESSION_DO",
    "RUN_NOTIFIER",
    "RUN_QUEUE",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "ADMIN_DOMAIN",
    "TENANT_BASE_DOMAIN",
    "PLATFORM_PRIVATE_KEY",
    "PLATFORM_PUBLIC_KEY",
    // Required by /internal/executor-rpc/*, which validates forwarded
    // executor-host requests using this shared secret.
    "EXECUTOR_PROXY_SECRET",
    // Required at runtime by common-env crypto helpers (`getCommonEnvSecret`
    // throws if unset). Fail fast at boot rather than deferring to first use.
    "ENCRYPTION_KEY",
  ],
  "takos-worker": ["DB", "RUN_QUEUE", "RUN_NOTIFIER"],
  "takos-workflow-runner": ["DB"],
  "takos-deployment-queue": ["DB", "ENCRYPTION_KEY", "HOSTNAME_ROUTING"],
  "takos-indexer": ["DB"],
  "takos-runtime-host": ["RUNTIME_CONTAINER", "PLATFORM_PUBLIC_KEY"],
  "takos-executor-host": [
    "EXECUTOR_CONTAINER",
    "TAKOS_CONTROL",
    "CONTROL_RPC_BASE_URL",
    "EXECUTOR_PROXY_SECRET",
  ],
} as const;

// ---------------------------------------------------------------------------
// Per-worker validators (backward-compatible wrappers)
// ---------------------------------------------------------------------------

export function validateWebEnv(env: object): string | null {
  return validateEnv("takos", env, REQUIRED_KEYS["takos"]);
}

export function validateDispatchEnv(
  env: object,
): string | null {
  // Custom logic: HOSTNAME_ROUTING and ROUTING_STORE are alternatives.
  const missing = ["DISPATCHER", "ADMIN_DOMAIN"].filter((k) =>
    !Reflect.get(env, k)
  );
  if (
    !Reflect.get(env, "HOSTNAME_ROUTING") && !Reflect.get(env, "ROUTING_STORE")
  ) {
    missing.push("HOSTNAME_ROUTING|ROUTING_STORE");
  }
  if (missing.length === 0) return null;
  return `[takos-dispatch] Missing required environment bindings: ${
    missing.join(", ")
  }`;
}

export function validateRunnerEnv(env: object): string | null {
  return validateEnv("takos-worker", env, REQUIRED_KEYS["takos-worker"]);
}

export function validateWorkflowRunnerEnv(
  env: object,
): string | null {
  return validateEnv(
    "takos-workflow-runner",
    env,
    REQUIRED_KEYS["takos-workflow-runner"],
  );
}

export function validateDeploymentQueueEnv(
  env: object,
): string | null {
  return validateEnv(
    "takos-deployment-queue",
    env,
    REQUIRED_KEYS["takos-deployment-queue"],
  );
}

export function validateIndexerEnv(
  env: object,
): string | null {
  return validateEnv("takos-indexer", env, REQUIRED_KEYS["takos-indexer"]);
}

export function validateEgressEnv(
  _env: object,
): string | null {
  // Egress has no required bindings; validation is a no-op.
  return null;
}

export function validateRuntimeHostEnv(
  env: object,
): string | null {
  const missing = validateEnv(
    "takos-runtime-host",
    env,
    REQUIRED_KEYS["takos-runtime-host"],
  );
  if (missing) return missing;

  const jwtPublicKey = normalizeKeyForCompare(
    optionalString(env, "JWT_PUBLIC_KEY"),
  );
  const platformPublicKey = normalizeKeyForCompare(
    optionalString(env, "PLATFORM_PUBLIC_KEY"),
  );
  if (!platformPublicKey) {
    return "[takos-runtime-host] Missing required environment bindings: PLATFORM_PUBLIC_KEY";
  }
  if (jwtPublicKey && jwtPublicKey !== platformPublicKey) {
    return "[takos-runtime-host] JWT_PUBLIC_KEY must match PLATFORM_PUBLIC_KEY because runtime-service JWTs are signed with PLATFORM_PRIVATE_KEY";
  }

  return null;
}

export function validateExecutorHostEnv(
  env: object,
): string | null {
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
