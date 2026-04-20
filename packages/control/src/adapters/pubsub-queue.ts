import type { Message, PubSub } from "@google-cloud/pubsub";
import type { Queue } from "../shared/types/bindings.ts";
import type {
  ConsumableQueue,
  LocalQueueName,
  LocalQueueRecord,
} from "../local-platform/queue-runtime.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type PubSubQueueConfig = {
  projectId?: string;
  topicName: string;
  keyFilePath?: string;
  /** Subscription name for pulling messages. Required for receive(). */
  subscriptionName?: string;
  /** Logical queue name used by the worker loop for DLQ / retry-limit lookup. */
  queueName?: LocalQueueName;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lazyPubSub(config: PubSubQueueConfig): () => Promise<PubSub> {
  let pubsubPromise: Promise<PubSub> | undefined;
  return async () => {
    if (!pubsubPromise) {
      pubsubPromise = (async () => {
        const { PubSub } = await import("@google-cloud/pubsub");
        return new PubSub({
          ...(config.projectId ? { projectId: config.projectId } : {}),
          ...(config.keyFilePath ? { keyFilename: config.keyFilePath } : {}),
        });
      })();
    }
    return pubsubPromise;
  };
}

function decodeMessageData(message: Message): string {
  const data = message.data as unknown;
  if (!data) return "{}";
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) {
    return new TextDecoder().decode(data);
  }
  if (
    typeof data === "object" && data !== null && "toString" in data &&
    typeof data.toString === "function"
  ) {
    return (data as { toString(encoding?: string): string }).toString("utf-8");
  }
  return "{}";
}

const RECEIVE_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
export function createPubSubQueue<T = unknown>(
  config: PubSubQueueConfig,
): Queue<T> & Partial<ConsumableQueue<T>> {
  const getPubSub = lazyPubSub(config);

  async function getTopic() {
    return (await getPubSub()).topic(config.topicName);
  }

  const queue: Queue<T> & Partial<ConsumableQueue<T>> = {
    // -- ConsumableQueue metadata ------------------------------------------
    ...(config.queueName ? { queueName: config.queueName } : {}),

    // -- Send --------------------------------------------------------------
    async send(
      message: T,
      _options?: unknown,
    ): Promise<void> {
      const topic = await getTopic();
      await topic.publishMessage({ json: message as Record<string, unknown> });
    },

    async sendBatch(
      messages: Iterable<{ body: T }>,
    ): Promise<void> {
      const topic = await getTopic();
      for (const msg of messages) {
        await topic.publishMessage({
          json: msg.body as Record<string, unknown>,
        });
      }
    },

    // -- Receive (ConsumableQueue) -----------------------------------------
    async receive(): Promise<LocalQueueRecord<T> | null> {
      if (!config.subscriptionName) {
        throw new Error(
          "PubSub receive() requires a subscriptionName in config. " +
            "Set GCP_PUBSUB_{NAME}_SUBSCRIPTION to enable consuming.",
        );
      }

      const subscription = (await getPubSub()).subscription(
        config.subscriptionName,
      );

      // Use a temporary message listener with a timeout.
      // The subscription's streaming pull will deliver messages to the handler.
      return new Promise<LocalQueueRecord<T> | null>((resolve) => {
        let resolved = false;

        const timer = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          subscription.removeListener("message", onMessage);
          resolve(null);
        }, RECEIVE_TIMEOUT_MS);

        function onMessage(message: Message) {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          subscription.removeListener("message", onMessage);

          const body = JSON.parse(decodeMessageData(message)) as T;
          const deliveryAttempt = message.deliveryAttempt ?? 1;

          // Immediately acknowledge — matches the pop semantics of local queues.
          message.ack();

          resolve({
            body,
            attempts: deliveryAttempt,
          });
        }

        subscription.on("message", onMessage);
      });
    },
  };

  return queue;
}
