import type { Queue } from '../shared/types/bindings.ts';
import type { ConsumableQueue, LocalQueueName } from '../local-platform/queue-runtime.ts';
export type SqsQueueConfig = {
    region: string;
    queueUrl: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    /** Logical queue name used by the worker loop for DLQ / retry-limit lookup. */
    queueName?: LocalQueueName;
};
/**
 * Create an SQS-backed queue that implements both the standard Queue (send)
 * interface and the ConsumableQueue (receive) interface required by the
 * worker poll loop.
 *
 * `receive()` performs long-polling (20 s) and immediately deletes the
 * message on receipt, matching the pop semantics of local/Redis queues.
 */
export declare function createSqsQueue<T = unknown>(config: SqsQueueConfig): Queue<T> & Partial<ConsumableQueue<T>>;
//# sourceMappingURL=sqs-queue.d.ts.map