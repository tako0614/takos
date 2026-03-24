import { PubSub } from '@google-cloud/pubsub';
import type { Queue } from '../../shared/types/bindings.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type PubSubQueueConfig = {
  projectId?: string;
  topicName: string;
  keyFilePath?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lazyPubSub(config: PubSubQueueConfig): () => PubSub {
  let pubsub: PubSub | undefined;
  return () => {
    if (!pubsub) {
      pubsub = new PubSub({
        ...(config.projectId ? { projectId: config.projectId } : {}),
        ...(config.keyFilePath ? { keyFilename: config.keyFilePath } : {}),
      });
    }
    return pubsub;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createPubSubQueue<T = unknown>(config: PubSubQueueConfig): Queue<T> {
  const getPubSub = lazyPubSub(config);

  function getTopic() {
    return getPubSub().topic(config.topicName);
  }

  return {
    async send(
      message: T,
      _options?: unknown,
    ): Promise<void> {
      await getTopic().publishMessage({ json: message as Record<string, unknown> });
    },

    async sendBatch(
      messages: Iterable<{ body: T }>,
    ): Promise<void> {
      const topic = getTopic();
      for (const msg of messages) {
        await topic.publishMessage({ json: msg.body as Record<string, unknown> });
      }
    },
  } as unknown as Queue<T>;
}
