import type { QueueBinding, QueueMessageBatch } from '../shared/types/bindings.ts';
export declare const LOCAL_QUEUE_NAMES: {
    readonly run: "takos-runs";
    readonly index: "takos-index-jobs";
    readonly workflow: "takos-workflow-jobs";
    readonly deployment: "takos-deployment-jobs";
};
export declare const LOCAL_DLQ_QUEUE_NAMES: {
    readonly "takos-runs": "takos-runs-dlq";
    readonly "takos-index-jobs": "takos-index-jobs-dlq";
    readonly "takos-workflow-jobs": "takos-workflow-jobs-dlq";
    readonly "takos-deployment-jobs": "takos-deployment-jobs-dlq";
};
export declare const LOCAL_QUEUE_RETRY_LIMITS: {
    readonly "takos-runs": 3;
    readonly "takos-index-jobs": 2;
    readonly "takos-workflow-jobs": 3;
    readonly "takos-deployment-jobs": 3;
};
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
export declare function isConsumableQueue(value: unknown): value is ConsumableQueue<unknown>;
export declare function isLocalQueue(value: unknown): value is LocalQueue<unknown>;
export declare function buildLocalMessageBatch<T>(queueName: string, record: LocalQueueRecord<T>, hooks?: {
    onAck?: () => void;
    onRetry?: () => void;
}): QueueMessageBatch<T>;
//# sourceMappingURL=queue-runtime.d.ts.map