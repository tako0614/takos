/**
 * The one description of Takos's Queue topology.
 *
 * Three files used to declare it independently — the OpenTofu module's
 * `queue_consumers` local, `wrangler.toml`'s production consumers, and its
 * staging consumers — and this file described it a fourth time with no
 * importer at all. They had drifted: the module gave every dead-letter queue
 * 100 retries, a concurrency and a retry delay, while `wrangler.toml` declared
 * none of them and so accepted Cloudflare's default of three attempts, and the
 * production `takos-notification-push-dlq` lost the ten-minute retry delay its
 * staging twin kept.
 *
 * `scripts/generate-queue-topology.ts` now writes all three from here, and
 * `bun run check` regenerates and diffs.
 */

import {
  RUN_QUEUE_MAX_CONCURRENCY,
  RUN_QUEUE_MAX_RETRIES,
  RUN_QUEUE_RETRY_BASE_DELAY_SECONDS,
} from "../src/worker/runtime/runner/run-queue-policy.ts";
import {
  DEAD_LETTER_QUEUE_MAX_BATCH_SIZE,
  DEAD_LETTER_QUEUE_MAX_BATCH_TIMEOUT_SECONDS,
  DEAD_LETTER_QUEUE_MAX_CONCURRENCY,
  DEAD_LETTER_QUEUE_MAX_RETRIES,
  DEAD_LETTER_QUEUE_RETRY_DELAY_SECONDS,
} from "../src/worker/runtime/queues/dead-letter-policy.ts";
import {
  INDEX_QUEUE_MAX_BATCH_SIZE,
  INDEX_QUEUE_MAX_BATCH_TIMEOUT_SECONDS,
  INDEX_QUEUE_MAX_CONCURRENCY,
  INDEX_QUEUE_MAX_RETRIES,
  INDEX_QUEUE_RETRY_DELAY_SECONDS,
} from "../src/worker/runtime/indexer/index-queue-policy.ts";
import {
  NOTIFICATION_PUSH_DLQ_MAX_RETRIES,
  NOTIFICATION_PUSH_DLQ_RETRY_DELAY_SECONDS,
  NOTIFICATION_PUSH_QUEUE_MAX_BATCH_SIZE,
  NOTIFICATION_PUSH_QUEUE_MAX_BATCH_TIMEOUT_SECONDS,
  NOTIFICATION_PUSH_QUEUE_MAX_CONCURRENCY,
  NOTIFICATION_PUSH_QUEUE_MAX_RETRIES,
  NOTIFICATION_PUSH_QUEUE_RETRY_BASE_DELAY_SECONDS,
} from "../src/worker/runtime/queues/notification-push-policy.ts";

export type QueueConsumerConfig = {
  /** Logical key, shared by the OpenTofu module and this contract. */
  readonly queueKey: string;
  /** Queue-name suffix appended to the deployment's project name. */
  readonly suffix: string;
  readonly batchSize: number;
  readonly batchTimeoutSeconds: number;
  readonly maxRetries: number;
  readonly maxConcurrency: number;
  readonly retryDelaySeconds: number;
  /** `null` for a dead-letter queue, which has no second DLQ. */
  readonly deadLetterQueueKey: string | null;
};

const deadLetterDefaults = {
  batchSize: DEAD_LETTER_QUEUE_MAX_BATCH_SIZE,
  batchTimeoutSeconds: DEAD_LETTER_QUEUE_MAX_BATCH_TIMEOUT_SECONDS,
  maxRetries: DEAD_LETTER_QUEUE_MAX_RETRIES,
  maxConcurrency: DEAD_LETTER_QUEUE_MAX_CONCURRENCY,
  retryDelaySeconds: DEAD_LETTER_QUEUE_RETRY_DELAY_SECONDS,
  deadLetterQueueKey: null,
} as const;

export const QUEUE_CONSUMERS: readonly QueueConsumerConfig[] = [
  {
    queueKey: "runs",
    suffix: "runs",
    batchSize: 1,
    batchTimeoutSeconds: 1,
    maxRetries: RUN_QUEUE_MAX_RETRIES,
    maxConcurrency: RUN_QUEUE_MAX_CONCURRENCY,
    retryDelaySeconds: RUN_QUEUE_RETRY_BASE_DELAY_SECONDS,
    deadLetterQueueKey: "runs_dlq",
  },
  { queueKey: "runs_dlq", suffix: "runs-dlq", ...deadLetterDefaults },
  {
    queueKey: "index_jobs",
    suffix: "index-jobs",
    batchSize: INDEX_QUEUE_MAX_BATCH_SIZE,
    batchTimeoutSeconds: INDEX_QUEUE_MAX_BATCH_TIMEOUT_SECONDS,
    maxRetries: INDEX_QUEUE_MAX_RETRIES,
    maxConcurrency: INDEX_QUEUE_MAX_CONCURRENCY,
    retryDelaySeconds: INDEX_QUEUE_RETRY_DELAY_SECONDS,
    deadLetterQueueKey: "index_jobs_dlq",
  },
  {
    queueKey: "index_jobs_dlq",
    suffix: "index-jobs-dlq",
    ...deadLetterDefaults,
  },
  {
    queueKey: "notification_push",
    suffix: "notification-push",
    batchSize: NOTIFICATION_PUSH_QUEUE_MAX_BATCH_SIZE,
    batchTimeoutSeconds: NOTIFICATION_PUSH_QUEUE_MAX_BATCH_TIMEOUT_SECONDS,
    maxRetries: NOTIFICATION_PUSH_QUEUE_MAX_RETRIES,
    maxConcurrency: NOTIFICATION_PUSH_QUEUE_MAX_CONCURRENCY,
    retryDelaySeconds: NOTIFICATION_PUSH_QUEUE_RETRY_BASE_DELAY_SECONDS,
    deadLetterQueueKey: "notification_push_dlq",
  },
  {
    queueKey: "notification_push_dlq",
    suffix: "notification-push-dlq",
    ...deadLetterDefaults,
    maxRetries: NOTIFICATION_PUSH_DLQ_MAX_RETRIES,
    retryDelaySeconds: NOTIFICATION_PUSH_DLQ_RETRY_DELAY_SECONDS,
  },
];

/** Producer bindings, so the Worker's queue names come from here too. */
export const QUEUE_PRODUCERS: readonly {
  readonly queueKey: string;
  readonly binding: string;
}[] = [
  { queueKey: "runs", binding: "RUN_QUEUE" },
  { queueKey: "index_jobs", binding: "INDEX_QUEUE" },
  { queueKey: "notification_push", binding: "TAKOS_NOTIFICATION_PUSH_QUEUE" },
];

export function queueSuffix(queueKey: string): string {
  const found = QUEUE_CONSUMERS.find(
    (consumer) => consumer.queueKey === queueKey,
  );
  if (!found) throw new Error(`unknown queue key ${queueKey}`);
  return found.suffix;
}
