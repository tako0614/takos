import { getDb } from "../../../infra/db/index.ts";

import { cloneEntries } from "./featured-app-validation.ts";
import type {
  FeaturedAppCatalogDefaults,
  FeaturedAppCatalogEntry,
  FeaturedAppCatalogEnv,
} from "./featured-app-catalog-types.ts";
import { type TtlMs, ttlMs } from "@takos/worker-platform-utils/ttl";

export type FeaturedAppFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class FeaturedAppCatalogUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FeaturedAppCatalogUnavailableError";
  }
}

export class FeaturedAppCatalogInvalidError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FeaturedAppCatalogInvalidError";
  }
}

export class FeaturedAppPreinstallConflictError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FeaturedAppPreinstallConflictError";
  }
}

export const featuredAppCatalogDeps: {
  getDb: typeof getDb;
  fetch: FeaturedAppFetch;
} = {
  getDb,
  fetch: (input, init) => fetch(input, init),
};

export const DB_CATALOG_CACHE_TTL_MS: TtlMs = ttlMs(30_000);
export const FEATURED_APP_PREINSTALL_MAX_ATTEMPTS = 8;
export const FEATURED_APP_PREINSTALL_LEASE_MS: TtlMs = ttlMs(15 * 60_000);

export type PersistedFeaturedAppCatalog = {
  configured: boolean;
  entries: FeaturedAppCatalogEntry[];
};

export type PersistedCatalogCacheEntry = {
  key: string;
  catalog: PersistedFeaturedAppCatalog;
  expiresAt: number;
};

let persistedCatalogCache = new WeakMap<
  object,
  PersistedCatalogCacheEntry
>();

export function clearFeaturedAppCatalogCache(): void {
  persistedCatalogCache = new WeakMap();
}

/**
 * Drop the persisted-catalog cache entry for a specific DB binding so
 * the next reader is forced to re-read from the database. Writers in
 * `featured-app-preinstall-jobs.ts` call this after mutating the persistent
 * catalog rows, ensuring stale 30s data is not served by the in-memory
 * cache.
 *
 * NOTE: this only clears the cache **in the current isolate**. Other isolates
 * (e.g. other Workers / processes) will continue to see their own cache
 * until it expires naturally. Cross-isolate invalidation requires a shared
 * signal (e.g. KV invalidation marker), which is out of scope for this
 * helper; the alternative — refreshing `expiresAt` only — is strictly worse
 * because it does not even fix the same-isolate case.
 */
export function invalidateCatalogCache(
  dbBinding: FeaturedAppCatalogEnv["DB"],
): void {
  if (typeof dbBinding === "object" && dbBinding !== null) {
    persistedCatalogCache.delete(dbBinding);
  }
}

export function defaultsCacheKey(
  defaults: FeaturedAppCatalogDefaults,
): string {
  return JSON.stringify(defaults);
}

export function getCatalogCacheEntry(
  dbBinding: FeaturedAppCatalogEnv["DB"],
): PersistedCatalogCacheEntry | null {
  return typeof dbBinding === "object" && dbBinding !== null
    ? persistedCatalogCache.get(dbBinding) ?? null
    : null;
}

export function setCatalogCacheEntry(
  dbBinding: FeaturedAppCatalogEnv["DB"],
  entry: PersistedCatalogCacheEntry,
): void {
  if (typeof dbBinding === "object" && dbBinding !== null) {
    persistedCatalogCache.set(dbBinding, entry);
  }
}

export function clonePersistedCatalog(
  catalog: PersistedFeaturedAppCatalog,
): PersistedFeaturedAppCatalog {
  return {
    configured: catalog.configured,
    entries: cloneEntries(catalog.entries),
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

export function isFeaturedAppCatalogInvalidError(
  error: unknown,
): boolean {
  return error instanceof FeaturedAppCatalogInvalidError;
}

export function isFeaturedAppCatalogConfigError(
  error: unknown,
): boolean {
  return error instanceof FeaturedAppCatalogInvalidError;
}

export function hasFeaturedAppCatalogEnvOverride(
  env: FeaturedAppCatalogEnv,
): boolean {
  return Boolean(
    env.TAKOS_FEATURED_APP_CATALOG_JSON?.trim() ||
      env.TAKOS_FEATURED_APP_REPOSITORIES_JSON?.trim(),
  );
}

export function isPreinstallJobStatus(
  value: string,
): value is import("./featured-app-catalog-types.ts").FeaturedAppPreinstallJobStatus {
  return value === "queued" || value === "in_progress" ||
    value === "blocked_by_config" || value === "paused_by_operator" ||
    value === "completed" || value === "failed";
}

export function normalizePreinstallJobStatus(
  value: string,
): import("./featured-app-catalog-types.ts").FeaturedAppPreinstallJobStatus {
  return isPreinstallJobStatus(value) ? value : "queued";
}
