import type {
  Queue,
} from '../shared/types/bindings.ts';
import type { LocalQueue, LocalQueueRecord } from './queue-runtime.ts';

export function createInMemoryQueue<T = unknown>(queueName = 'takos-runs'): Queue<T> {
  const sent: Array<LocalQueueRecord<T>> = [];
  const queue = {
    queueName,
    sent,
    async send(message: T, options?: unknown) {
      sent.push({ body: message, options });
    },
    async sendBatch(messages: Iterable<unknown>) {
      for (const message of messages) sent.push(message as LocalQueueRecord<T>);
    },
    async receive() {
      return sent.shift() ?? null;
    },
  };

  return queue as unknown as LocalQueue<T>;
}
