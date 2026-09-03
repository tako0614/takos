/**
 * Settings shared by every Takos dead-letter queue.
 *
 * A DLQ has no second DLQ, so Cloudflare's default three delivery attempts is
 * the difference between "the consumer was briefly unable to reach D1" and
 * "the message is gone". These values keep an outage inside the retry budget
 * while staying bounded well below the shortest Queue retention.
 */

/** Attempts before a dead-letter message is dropped for good. */
export const DEAD_LETTER_QUEUE_MAX_RETRIES = 100;
/** Concurrent consumer invocations; a DLQ drains, it does not race. */
export const DEAD_LETTER_QUEUE_MAX_CONCURRENCY = 5;
/** Seconds before a failed dead-letter delivery is retried. */
export const DEAD_LETTER_QUEUE_RETRY_DELAY_SECONDS = 5;
/** Messages per batch. */
export const DEAD_LETTER_QUEUE_MAX_BATCH_SIZE = 10;
/** Seconds a partial batch waits before it is delivered anyway. */
export const DEAD_LETTER_QUEUE_MAX_BATCH_TIMEOUT_SECONDS = 60;
