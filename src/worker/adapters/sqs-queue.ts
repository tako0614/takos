import {
  DeleteMessageCommand,
  MessageSystemAttributeName,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { MessageQueueBinding } from "../shared/types/bindings.ts";
import type {
  ConsumableQueue,
  LocalQueueName,
  LocalQueueRecord,
} from "../local-platform/queue-runtime.ts";
import { logError } from "../shared/utils/logger.ts";

export type SqsQueueConfig = {
  region: string;
  queueUrl: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Logical queue name used by the service loop for DLQ / retry-limit lookup. */
  queueName?: LocalQueueName;
};

/**
 * Create an SQS-backed adapter that implements both the standard message queue (send)
 * interface and the ConsumableQueue (receive) interface required by the
 * service poll loop.
 *
 * `receive()` performs long-polling (20 s) and immediately deletes the
 * message on receipt, matching the pop semantics of local/Redis queues.
 */
export function createSqsQueue<T = unknown>(
  config: SqsQueueConfig,
): MessageQueueBinding<T> & Partial<ConsumableQueue<T>> {
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

  const queue: MessageQueueBinding<T> & Partial<ConsumableQueue<T>> = {
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
      // Parse defensively. A malformed body would otherwise throw before the
      // delete below, leaving the message in the queue to be redelivered
      // forever (poison message). Drop poison messages here so the queue
      // moves on; SQS-side DLQ policy (maxReceiveCount on the source queue)
      // can still capture them if configured by the operator.
      let body: T;
      try {
        body = JSON.parse(msg.Body ?? "{}") as T;
      } catch (err) {
        logError("sqs-queue: dropping poison message (JSON parse failed)", {
          module: "sqs-queue",
          queueUrl: config.queueUrl,
          queueName: config.queueName,
          messageId: msg.MessageId,
          bodyLength: msg.Body?.length ?? 0,
          detail: err,
        });
        if (msg.ReceiptHandle) {
          try {
            const deleteCmd = new DeleteMessageCommand({
              QueueUrl: config.queueUrl,
              ReceiptHandle: msg.ReceiptHandle,
            });
            await getClient().send(deleteCmd);
          } catch (deleteErr) {
            // If the delete fails, the message will become visible again
            // after the visibility timeout. The next receive() will hit the
            // same parse failure and try to delete it again. Surface the
            // error so operators can investigate.
            logError("sqs-queue: failed to delete poison message", {
              module: "sqs-queue",
              queueUrl: config.queueUrl,
              messageId: msg.MessageId,
              detail: deleteErr,
            });
          }
        }
        return null;
      }

      // Immediately delete — matches the pop semantics of local queues.
      // On retry the service loop re-enqueues via sendBatch().
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
