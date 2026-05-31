/**
 * Generic resolver factory for the cloud -> persistent-local -> in-memory cascade.
 *
 * Most resource resolvers follow the same pattern:
 *   1. Try one or more cloud adapters (conditional on env vars).
 *   2. Fall back to a persistent local implementation (conditional on dataDir).
 *   3. Fall back to an in-memory implementation.
 *
 * This factory encodes that pattern so each resolver file only declares
 * its cloud adapter checks, persistent factory, and in-memory factory.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single cloud adapter probe.  The resolver factory calls `tryCreate` and
 * uses its result if it returns a non-nullish value.
 */
export interface CloudAdapterProbe<T> {
  tryCreate(): Promise<T | null | undefined> | T | null | undefined;
}

/**
 * Configuration for the resolver factory.
 *
 * @typeParam T - The type of binding/resource being resolved.
 */
export interface ResolverConfig<T> {
  /** Ordered list of cloud adapter probes. First non-nullish result wins. */
  cloudAdapters: CloudAdapterProbe<T>[];
  /** Create a persistent-local implementation. Called only when `dataDir` is non-null. */
  createPersistent: (dataDir: string) => T | Promise<T>;
  /** Create an in-memory implementation (ultimate fallback). */
  createInMemory: () => T | Promise<T>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a resolver function from a config.
 *
 * The returned async function walks the cloud adapters in order, then tries
 * persistent-local, then in-memory.
 */
export function createResolver<T>(
  config: ResolverConfig<T>,
): (dataDir: string | null) => Promise<T> {
  return async (dataDir: string | null): Promise<T> => {
    // Cloud adapters
    for (const probe of config.cloudAdapters) {
      const result = await probe.tryCreate();
      if (result != null) return result;
    }

    // Persistent local
    if (dataDir != null) return config.createPersistent(dataDir);

    // In-memory
    return config.createInMemory();
  };
}

/**
 * Variant that also accepts a `redisUrl` parameter in the fallback chain:
 *   cloud adapters -> Redis -> persistent-local -> in-memory
 */
export interface ResolverWithRedisConfig<T> {
  cloudAdapters: CloudAdapterProbe<T>[];
  /** Create a Redis-backed implementation. Called only when `redisUrl` is non-null. */
  createRedis: (redisUrl: string) => T | Promise<T>;
  createPersistent: (dataDir: string) => T | Promise<T>;
  createInMemory: () => T | Promise<T>;
}

export function createResolverWithRedis<T>(
  config: ResolverWithRedisConfig<T>,
): (redisUrl: string | null, dataDir: string | null) => Promise<T> {
  return async (
    redisUrl: string | null,
    dataDir: string | null,
  ): Promise<T> => {
    for (const probe of config.cloudAdapters) {
      const result = await probe.tryCreate();
      if (result != null) return result;
    }

    if (redisUrl != null) return config.createRedis(redisUrl);
    if (dataDir != null) return config.createPersistent(dataDir);
    return config.createInMemory();
  };
}

/**
 * Synchronous variant for resolvers that have no async cloud adapter probes.
 * Follows the same cascade: Redis -> persistent-local -> in-memory, but all
 * factory functions must be synchronous.
 */
export interface SyncResolverWithRedisConfig<T> {
  createRedis: (redisUrl: string) => T;
  createPersistent: (dataDir: string) => T;
  createInMemory: () => T;
}

export function createSyncResolverWithRedis<T>(
  config: SyncResolverWithRedisConfig<T>,
): (redisUrl: string | null, dataDir: string | null) => T {
  return (redisUrl: string | null, dataDir: string | null): T => {
    if (redisUrl != null) return config.createRedis(redisUrl);
    if (dataDir != null) return config.createPersistent(dataDir);
    return config.createInMemory();
  };
}
