/**
 * Shared infrastructure for cloud queue adapters (SQS, Pub/Sub, etc.).
 *
 * Each adapter supplies provider-specific `send`, `sendBatch`, and `receive`
 * callbacks.  This module wires them into the canonical
 * `Queue<T> & Partial<ConsumableQueue<T>>` shape expected by the worker poll
 * loop, handling the common queueName metadata plumbing.
 */

import type { Queue } from '../shared/types/bindings.ts';
import type { ConsumableQueue, LocalQueueName, LocalQueueRecord } from '../local-platform/queue-runtime.ts';

// ---------------------------------------------------------------------------
// Config base shared by all queue adapters
// ---------------------------------------------------------------------------

/** Fields every queue adapter config must include. */
export type QueueAdapterConfigBase = {
  /** Logical queue name used by the worker loop for DLQ / retry-limit lookup. */
  queueName?: LocalQueueName;
};

// ---------------------------------------------------------------------------
// Provider callbacks
// ---------------------------------------------------------------------------

export type QueueProviderCallbacks<T> = {
  send(message: T, options?: { delaySeconds?: number }): Promise<void>;
  sendBatch(messages: Iterable<{ body: T; delaySeconds?: number }>): Promise<void>;
  /** If undefined, the adapter will not expose receive(). */
  receive?: () => Promise<LocalQueueRecord<T> | null>;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the standard queue adapter object from provider-specific callbacks.
 *
 * The returned object satisfies `Queue<T> & Partial<ConsumableQueue<T>>`.
 */
export function buildQueueAdapter<T>(
  config: QueueAdapterConfigBase,
  callbacks: QueueProviderCallbacks<T>,
): Queue<T> & Partial<ConsumableQueue<T>> {
  const queue = {
    // -- ConsumableQueue metadata ------------------------------------------
    ...(config.queueName ? { queueName: config.queueName } : {}),

    // -- Send --------------------------------------------------------------
    send: callbacks.send,
    sendBatch: callbacks.sendBatch,

    // -- Receive (ConsumableQueue) -----------------------------------------
    ...(callbacks.receive ? { receive: callbacks.receive } : {}),
  };

  return queue as unknown as Queue<T> & Partial<ConsumableQueue<T>>;
}

// ---------------------------------------------------------------------------
// Lazy-init helper
// ---------------------------------------------------------------------------

/**
 * Create a lazy-initializing getter for a cloud SDK client.
 *
 * The `factory` is called at most once; subsequent calls return the cached
 * instance.
 */
export function lazyClient<C>(factory: () => C): () => C {
  let instance: C | undefined;
  return () => {
    if (!instance) {
      instance = factory();
    }
    return instance;
  };
}
