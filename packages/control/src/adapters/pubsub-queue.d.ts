import type { Queue } from '../shared/types/bindings.ts';
import type { ConsumableQueue, LocalQueueName } from '../local-platform/queue-runtime.ts';
export type PubSubQueueConfig = {
    projectId?: string;
    topicName: string;
    keyFilePath?: string;
    /** Subscription name for pulling messages. Required for receive(). */
    subscriptionName?: string;
    /** Logical queue name used by the worker loop for DLQ / retry-limit lookup. */
    queueName?: LocalQueueName;
};
/**
 * Create a Pub/Sub-backed queue that implements both the standard Queue (send)
 * interface and the ConsumableQueue (receive) interface required by the
 * worker poll loop.
 *
 * `receive()` attaches a temporary message listener on the subscription and
 * waits up to 20 s.  The message is immediately acknowledged on receipt,
 * matching the pop semantics of local/Redis queues.
 * A `subscriptionName` must be provided in config for receive() to work.
 */
export declare function createPubSubQueue<T = unknown>(config: PubSubQueueConfig): Queue<T> & Partial<ConsumableQueue<T>>;
//# sourceMappingURL=pubsub-queue.d.ts.map