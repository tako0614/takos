import {
  RUN_QUEUE_MAX_CONCURRENCY,
  RUN_QUEUE_MAX_RETRIES,
  RUN_QUEUE_RETRY_BASE_DELAY_SECONDS,
} from "../../src/worker/runtime/runner/run-queue-policy.ts";
import {
  NOTIFICATION_PUSH_QUEUE_MAX_BATCH_SIZE,
  NOTIFICATION_PUSH_QUEUE_MAX_BATCH_TIMEOUT_SECONDS,
  NOTIFICATION_PUSH_QUEUE_MAX_CONCURRENCY,
  NOTIFICATION_PUSH_QUEUE_MAX_RETRIES,
  NOTIFICATION_PUSH_QUEUE_RETRY_BASE_DELAY_SECONDS,
} from "../../src/worker/runtime/queues/notification-push-policy.ts";

export type QueueConsumerConfig = {
  queueKey: string;
  batchSize: number;
  batchTimeout: number;
  messageRetries?: number;
  deadLetterQueueKey?: string;
  maxConcurrency?: number;
  retryDelaySeconds?: number;
};

export const QUEUE_CONSUMERS: readonly QueueConsumerConfig[] = [
  {
    queueKey: "runs",
    batchSize: 1,
    batchTimeout: 1,
    messageRetries: RUN_QUEUE_MAX_RETRIES,
    deadLetterQueueKey: "runs_dlq",
    maxConcurrency: RUN_QUEUE_MAX_CONCURRENCY,
    retryDelaySeconds: RUN_QUEUE_RETRY_BASE_DELAY_SECONDS,
  },
  {
    queueKey: "runs_dlq",
    batchSize: 10,
    batchTimeout: 60,
  },
  {
    queueKey: "index_jobs",
    batchSize: 5,
    batchTimeout: 60,
    messageRetries: 2,
    deadLetterQueueKey: "index_jobs_dlq",
  },
  {
    queueKey: "index_jobs_dlq",
    batchSize: 10,
    batchTimeout: 60,
  },
  {
    queueKey: "workflow",
    batchSize: 1,
    batchTimeout: 1,
    messageRetries: 3,
    deadLetterQueueKey: "workflow_dlq",
  },
  {
    queueKey: "workflow_dlq",
    batchSize: 10,
    batchTimeout: 60,
  },
  {
    queueKey: "deployment",
    batchSize: 1,
    batchTimeout: 1,
    messageRetries: 3,
    deadLetterQueueKey: "deployment_dlq",
  },
  {
    queueKey: "deployment_dlq",
    batchSize: 10,
    batchTimeout: 60,
  },
  {
    queueKey: "notification_push",
    batchSize: NOTIFICATION_PUSH_QUEUE_MAX_BATCH_SIZE,
    batchTimeout: NOTIFICATION_PUSH_QUEUE_MAX_BATCH_TIMEOUT_SECONDS,
    messageRetries: NOTIFICATION_PUSH_QUEUE_MAX_RETRIES,
    deadLetterQueueKey: "notification_push_dlq",
    maxConcurrency: NOTIFICATION_PUSH_QUEUE_MAX_CONCURRENCY,
    retryDelaySeconds: NOTIFICATION_PUSH_QUEUE_RETRY_BASE_DELAY_SECONDS,
  },
  {
    queueKey: "notification_push_dlq",
    batchSize: 10,
    batchTimeout: 60,
  },
];
