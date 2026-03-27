import type { Queue } from '../shared/types/bindings.ts';
import type { LocalQueue, LocalQueueRecord } from './queue-runtime.ts';
import { readJsonFile, writeJsonFile } from './persistent-shared.ts';
import { logWarn } from '../shared/utils/logger.ts';

type QueueState<T = unknown> = {
  messages: T[];
};

export function createPersistentQueue<T = unknown>(queueFile: string, queueName = 'takos-runs'): Queue<T> {
  type QueueRecord = LocalQueueRecord<T>;
  let cache: QueueState<QueueRecord> | null = null;

  async function loadMessages(): Promise<QueueState<QueueRecord>> {
    if (cache) return cache;
    cache = await readJsonFile<QueueState<QueueRecord>>(queueFile, { messages: [] });
    return cache;
  }

  async function flushMessages(): Promise<void> {
    if (!cache) return;
    await writeJsonFile(queueFile, cache);
  }

  const queue = {
    queueName,
    sent: [] as QueueRecord[],
    async send(message: T, options?: unknown) {
      const messages = await loadMessages();
      const record = { body: message, options };
      messages.messages.push(record);
      queue.sent.push(record);
      await flushMessages();
    },
    async sendBatch(messages: Iterable<unknown>) {
      const persisted = await loadMessages();
      for (const message of messages) {
        const record = message as QueueRecord;
        persisted.messages.push(record);
        queue.sent.push(record);
      }
      await flushMessages();
    },
    async receive() {
      const persisted = await loadMessages();
      const record = persisted.messages.shift() ?? null;
      if (!record) return null;
      queue.sent.splice(0, queue.sent.length, ...persisted.messages);
      await flushMessages();
      return record;
    },
  };

  void loadMessages().then((messages) => {
    queue.sent.splice(0, queue.sent.length, ...messages.messages);
  }).catch((err) => logWarn('Failed to pre-load messages', { module: 'persistent-queue', error: err instanceof Error ? err.message : String(err) }));

  return queue as unknown as LocalQueue<T>;
}
