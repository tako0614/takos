import {
  DeleteMessageCommand,
  MessageSystemAttributeName,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { Queue } from "../shared/types/bindings.ts";
import type {
  ConsumableQueue,
  LocalQueueName,
  LocalQueueRecord,
} from "../local-platform/queue-runtime.ts";

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
export function createSqsQueue<T = unknown>(
  config: SqsQueueConfig,
): Queue<T> & Partial<ConsumableQueue<T>> {
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

  const queue: Queue<T> & Partial<ConsumableQueue<T>> = {
    // -- ConsumableQueue metadata ------------------------------------------
    ...(config.queueName ? { queueName: config.queueName } : {}),

    // -- Send --------------------------------------------------------------
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

    // -- Receive (ConsumableQueue) -----------------------------------------
    async receive(): Promise<LocalQueueRecord<T> | null> {
      const receiveCmd = new ReceiveMessageCommand({
        QueueUrl: config.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
        MessageSystemAttributeNames: [
          MessageSystemAttributeName.ApproximateReceiveCount,
        ],
      });

      const response = await getClient().send(receiveCmd);
      const messages = response.Messages;
      if (!messages || messages.length === 0) return null;

      const msg = messages[0];
      const body = JSON.parse(msg.Body ?? "{}") as T;

      // Immediately delete — matches the pop semantics of local queues.
      // On retry the worker loop re-enqueues via sendBatch().
      if (msg.ReceiptHandle) {
        const deleteCmd = new DeleteMessageCommand({
          QueueUrl: config.queueUrl,
          ReceiptHandle: msg.ReceiptHandle,
        });
        await getClient().send(deleteCmd);
      }

      const approximateReceiveCount = Number(
        msg.Attributes?.ApproximateReceiveCount ??
          msg.MessageAttributes?.ApproximateReceiveCount?.StringValue ??
          "1",
      );

      return {
        body,
        attempts: approximateReceiveCount,
      };
    },
  };

  return queue;
}
