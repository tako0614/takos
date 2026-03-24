import {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
} from '@aws-sdk/client-sqs';
import type { Queue } from '../../shared/types/bindings.ts';

export type SqsQueueConfig = {
  region: string;
  queueUrl: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export function createSqsQueue<T = unknown>(config: SqsQueueConfig): Queue<T> {
  let client: SQSClient | undefined;

  function getClient(): SQSClient {
    if (!client) {
      client = new SQSClient({
        region: config.region,
        ...(config.accessKeyId && config.secretAccessKey
          ? {
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              },
            }
          : {}),
      });
    }
    return client;
  }

  return {
    async send(
      message: T,
      options?: { delaySeconds?: number },
    ): Promise<void> {
      const command = new SendMessageCommand({
        QueueUrl: config.queueUrl,
        MessageBody: JSON.stringify(message),
        ...(options?.delaySeconds !== undefined
          ? { DelaySeconds: options.delaySeconds }
          : {}),
      });
      await getClient().send(command);
    },

    async sendBatch(
      messages: Iterable<{ body: T; delaySeconds?: number }>,
    ): Promise<void> {
      const entries = Array.from(messages).map((msg) => ({
        Id: crypto.randomUUID(),
        MessageBody: JSON.stringify(msg.body),
        ...(msg.delaySeconds !== undefined
          ? { DelaySeconds: msg.delaySeconds }
          : {}),
      }));

      if (entries.length === 0) return;

      // SQS SendMessageBatch supports a maximum of 10 entries per call.
      const BATCH_SIZE = 10;
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const command = new SendMessageBatchCommand({
          QueueUrl: config.queueUrl,
          Entries: batch,
        });
        await getClient().send(command);
      }
    },
  } as unknown as Queue<T>;
}
