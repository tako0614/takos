/**
 * Index-job queue settings.
 *
 * Indexing is derived work: a failed job is re-derivable from durable state,
 * so it retries a small number of times and then dead-letters rather than
 * occupying the queue.
 */

export const INDEX_QUEUE_MAX_BATCH_SIZE = 5;
export const INDEX_QUEUE_MAX_BATCH_TIMEOUT_SECONDS = 60;
export const INDEX_QUEUE_MAX_RETRIES = 2;
export const INDEX_QUEUE_MAX_CONCURRENCY = 5;
export const INDEX_QUEUE_RETRY_DELAY_SECONDS = 5;
