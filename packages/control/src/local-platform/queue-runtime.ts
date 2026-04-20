import type {
  QueueBinding,
  QueueMessageBatch,
} from "../shared/types/bindings.ts";

export const LOCAL_QUEUE_NAMES = {
  run: "takos-runs",
  index: "takos-index-jobs",
  workflow: "takos-workflow-jobs",
  deployment: "takos-deployment-jobs",
} as const;

export const LOCAL_DLQ_QUEUE_NAMES = {
  [LOCAL_QUEUE_NAMES.run]: "takos-runs-dlq",
  [LOCAL_QUEUE_NAMES.index]: "takos-index-jobs-dlq",
  [LOCAL_QUEUE_NAMES.workflow]: "takos-workflow-jobs-dlq",
  [LOCAL_QUEUE_NAMES.deployment]: "takos-deployment-jobs-dlq",
} as const;

export const LOCAL_QUEUE_RETRY_LIMITS = {
  [LOCAL_QUEUE_NAMES.run]: 3,
  [LOCAL_QUEUE_NAMES.index]: 2,
  [LOCAL_QUEUE_NAMES.workflow]: 3,
  [LOCAL_QUEUE_NAMES.deployment]: 3,
} as const;

export type LocalQueueName = keyof typeof LOCAL_DLQ_QUEUE_NAMES;

export type LocalQueueRecord<T = unknown> = {
  body: T;
  options?: unknown;
  attempts?: number;
};

/**
 * A queue that supports both send and receive — the minimal contract
 * required by the worker poll loop.  Cloud-backed queues (SQS, Pub/Sub)
 * implement this interface directly, while local/in-memory/Redis queues
 * extend it via {@link LocalQueue}.
 */
export type ConsumableQueue<T = unknown> = QueueBinding<T> & {
  queueName: LocalQueueName;
  receive(): Promise<LocalQueueRecord<T> | null>;
};

export type LocalQueue<T = unknown> = ConsumableQueue<T> & {
  sent: LocalQueueRecord<T>[];
};

export function isConsumableQueue(
  value: unknown,
): value is ConsumableQueue<unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConsumableQueue<unknown>>;
  return typeof candidate.queueName === "string" &&
    typeof candidate.receive === "function";
}

export function isLocalQueue(value: unknown): value is LocalQueue<unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalQueue<unknown>>;
  return typeof candidate.queueName === "string" &&
    typeof candidate.receive === "function";
}

export function buildLocalMessageBatch<T>(
  queueName: string,
  record: LocalQueueRecord<T>,
  hooks?: {
    onAck?: () => void;
    onRetry?: () => void;
  },
): QueueMessageBatch<T> {
  const attempts = Math.max(1, record.attempts ?? 1);
  const message = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    attempts,
    body: record.body,
    ack() {
      hooks?.onAck?.();
    },
    retry() {
      hooks?.onRetry?.();
    },
  };

  const batch: QueueMessageBatch<T> = {
    queue: queueName,
    messages: [message],
  };
  return batch;
}
