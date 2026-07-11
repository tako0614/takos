import { DEFAULT_EXECUTOR_LOGICAL_RUN_CAPACITY } from "../container-hosts/executor-capacity.ts";

/** Current Cloudflare Queues limit for concurrent push-consumer invocations. */
export const CLOUDFLARE_QUEUE_MAX_CONCURRENCY = 250;

/**
 * Dispatch no more Queue handlers than the executor pool can admit, capped by
 * the platform's consumer-concurrency limit.
 */
export const RUN_QUEUE_MAX_CONCURRENCY = Math.min(
  DEFAULT_EXECUTOR_LOGICAL_RUN_CAPACITY,
  CLOUDFLARE_QUEUE_MAX_CONCURRENCY,
);

export const RUN_QUEUE_MAX_RETRIES = 5;
export const RUN_QUEUE_RETRY_BASE_DELAY_SECONDS = 5;
export const RUN_QUEUE_RETRY_MAX_DELAY_SECONDS = 5 * 60;
export const RUN_QUEUE_BACKPRESSURE_BASE_DELAY_SECONDS = 5;
export const RUN_QUEUE_BACKPRESSURE_MAX_DELAY_SECONDS = 5 * 60;

/**
 * A DLQ message has no executor lease identity, so it may terminalize only a
 * run that is still waiting for ownership. `running` is intentionally absent:
 * an old duplicate must not overwrite a newer claimed lease.
 */
export const DLQ_TERMINALIZABLE_RUN_STATUSES = ["pending", "queued"] as const;

/** Exponential per-message backoff, starting at the configured retry delay. */
export function runQueueRetryDelaySeconds(attempts: number): number {
  const normalizedAttempts = Number.isFinite(attempts)
    ? Math.max(1, Math.floor(attempts))
    : 1;
  const exponent = Math.min(normalizedAttempts - 1, 30);
  return Math.min(
    RUN_QUEUE_RETRY_BASE_DELAY_SECONDS * 2 ** exponent,
    RUN_QUEUE_RETRY_MAX_DELAY_SECONDS,
  );
}

/**
 * Capacity exhaustion is a healthy backlog condition. Re-enqueued messages
 * carry this independent counter so Cloudflare's finite delivery-attempt budget
 * is reserved for actual consumer/queue failures. The delay is bounded, while
 * the number of deferrals is intentionally not a terminal failure condition.
 */
export function runQueueBackpressureDelaySeconds(
  backpressureCount: number,
): number {
  const normalizedCount = Number.isSafeInteger(backpressureCount)
    ? Math.max(1, backpressureCount)
    : 1;
  const exponent = Math.min(normalizedCount - 1, 30);
  return Math.min(
    RUN_QUEUE_BACKPRESSURE_BASE_DELAY_SECONDS * 2 ** exponent,
    RUN_QUEUE_BACKPRESSURE_MAX_DELAY_SECONDS,
  );
}

export function nextRunQueueBackpressureCount(current: unknown): number {
  if (
    typeof current !== "number" ||
    !Number.isSafeInteger(current) ||
    current < 0
  ) {
    return 1;
  }
  return Math.min(current + 1, Number.MAX_SAFE_INTEGER);
}
