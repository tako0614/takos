import { getDb } from "../../../infra/db/index.ts";

import { cloneEntries } from "./default-app-validation.ts";
import type {
  DefaultAppDistributionDefaults,
  DefaultAppDistributionEntry,
  DefaultAppDistributionEnv,
} from "./default-app-distribution-types.ts";
import { type TtlMs, ttlMs } from "@takos/worker-platform-utils/ttl";

export type DefaultAppFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class DefaultAppDistributionUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DefaultAppDistributionUnavailableError";
  }
}

export class DefaultAppDistributionInvalidError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DefaultAppDistributionInvalidError";
  }
}

export class DefaultAppPreinstallConflictError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DefaultAppPreinstallConflictError";
  }
}

export const defaultAppDistributionDeps: {
  getDb: typeof getDb;
  fetch: DefaultAppFetch;
} = {
  getDb,
  fetch: (input, init) => fetch(input, init),
};

export const DB_DISTRIBUTION_CACHE_TTL_MS: TtlMs = ttlMs(30_000);
export const DEFAULT_APP_PREINSTALL_MAX_ATTEMPTS = 8;
export const DEFAULT_APP_PREINSTALL_LEASE_MS: TtlMs = ttlMs(15 * 60_000);

export type PersistedDefaultAppDistribution = {
  configured: boolean;
  entries: DefaultAppDistributionEntry[];
};

export type PersistedDistributionCacheEntry = {
  key: string;
  distribution: PersistedDefaultAppDistribution;
  expiresAt: number;
};

let persistedDistributionCache = new WeakMap<
  object,
  PersistedDistributionCacheEntry
>();

export function clearDefaultAppDistributionCache(): void {
  persistedDistributionCache = new WeakMap();
}

/**
 * Drop the persisted-distribution cache entry for a specific DB binding so
 * the next reader is forced to re-read from the database. Writers in
 * `default-app-preinstall-jobs.ts` call this after mutating the persistent
 * distribution rows, ensuring stale 30s data is not served by the in-memory
 * cache.
 *
 * NOTE: this only clears the cache **in the current isolate**. Other isolates
 * (e.g. other Workers / processes) will continue to see their own cache
 * until it expires naturally. Cross-isolate invalidation requires a shared
 * signal (e.g. KV invalidation marker), which is out of scope for this
 * helper; the alternative — refreshing `expiresAt` only — is strictly worse
 * because it does not even fix the same-isolate case.
 */
export function invalidateDistributionCache(
  dbBinding: DefaultAppDistributionEnv["DB"],
): void {
  if (typeof dbBinding === "object" && dbBinding !== null) {
    persistedDistributionCache.delete(dbBinding);
  }
}

export function defaultsCacheKey(
  defaults: DefaultAppDistributionDefaults,
): string {
  return JSON.stringify(defaults);
}

export function getDistributionCacheEntry(
  dbBinding: DefaultAppDistributionEnv["DB"],
): PersistedDistributionCacheEntry | null {
  return typeof dbBinding === "object" && dbBinding !== null
    ? persistedDistributionCache.get(dbBinding) ?? null
    : null;
}

export function setDistributionCacheEntry(
  dbBinding: DefaultAppDistributionEnv["DB"],
  entry: PersistedDistributionCacheEntry,
): void {
  if (typeof dbBinding === "object" && dbBinding !== null) {
    persistedDistributionCache.set(dbBinding, entry);
  }
}

export function clonePersistedDistribution(
  distribution: PersistedDefaultAppDistribution,
): PersistedDefaultAppDistribution {
  return {
    configured: distribution.configured,
    entries: cloneEntries(distribution.entries),
  };
}

export async function runDbStatement(
  statement: { run?: () => Promise<unknown> },
): Promise<void> {
  if (typeof statement.run === "function") {
    await statement.run();
  } else {
    await statement;
  }
}

export function isDefaultAppDistributionInvalidError(
  error: unknown,
): boolean {
  return error instanceof DefaultAppDistributionInvalidError;
}

export function isDefaultAppDistributionConfigError(
  error: unknown,
): boolean {
  return error instanceof DefaultAppDistributionInvalidError;
}

export function hasDefaultAppDistributionEnvOverride(
  env: DefaultAppDistributionEnv,
): boolean {
  return Boolean(
    env.TAKOS_DEFAULT_APP_DISTRIBUTION_JSON?.trim() ||
      env.TAKOS_DEFAULT_APP_REPOSITORIES_JSON?.trim(),
  );
}

export function isPreinstallJobStatus(
  value: string,
): value is import("./default-app-distribution-types.ts").DefaultAppPreinstallJobStatus {
  return value === "queued" || value === "in_progress" ||
    value === "blocked_by_config" || value === "paused_by_operator" ||
    value === "completed" || value === "failed";
}

export function normalizePreinstallJobStatus(
  value: string,
): import("./default-app-distribution-types.ts").DefaultAppPreinstallJobStatus {
  return isPreinstallJobStatus(value) ? value : "queued";
}
