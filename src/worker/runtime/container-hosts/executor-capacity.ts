/**
 * Canonical default capacity policy for the managed executor pool.
 *
 * Cloudflare Container `max_instances`, Queue consumer concurrency, and the
 * in-worker pool selector are validated against these values so deploy config
 * cannot silently advertise less capacity than the logical pool addresses.
 */
export const DEFAULT_EXECUTOR_POOL_CAPACITY = Object.freeze({
  tier1WarmPoolSize: 1,
  tier1MaxConcurrentRuns: 4,
  tier3PoolSize: 25,
  tier3MaxConcurrentRuns: 32,
});

/** Tier 2 is reserved for explicit dispatch and is not part of the managed pool. */
export const DEFAULT_EXECUTOR_TIER2_MAX_INSTANCES = 1;

/** The TypeScript runtime container is a separate singleton host. */
export const DEFAULT_RUNTIME_CONTAINER_MAX_INSTANCES = 1;

/**
 * Let active work run for at least 15 minutes before a rolling update starts
 * the platform's graceful-termination window.
 */
export const CONTAINER_ROLLOUT_ACTIVE_GRACE_PERIOD_SECONDS = 15 * 60;

export const DEFAULT_EXECUTOR_LOGICAL_RUN_CAPACITY =
  DEFAULT_EXECUTOR_POOL_CAPACITY.tier1WarmPoolSize *
    DEFAULT_EXECUTOR_POOL_CAPACITY.tier1MaxConcurrentRuns +
  DEFAULT_EXECUTOR_POOL_CAPACITY.tier3PoolSize *
    DEFAULT_EXECUTOR_POOL_CAPACITY.tier3MaxConcurrentRuns;
