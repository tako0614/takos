import { assert, assertEquals } from "@std/assert";
import { createSqsQueue } from "../sqs-queue.ts";

// We mock the SQSClient.send by intercepting the @aws-sdk/client-sqs module's
// SQSClient constructor. The adapter calls `new SQSClient(...)` lazily inside
// `getClient()`, so monkey-patching the prototype is the simplest path here.

import { SQSClient } from "@aws-sdk/client-sqs";

interface SqsCall {
  command: { constructor: { name: string }; input: Record<string, unknown> };
}

function withMockedSqs<T>(
  queue: Array<{ Body: string; ReceiptHandle: string; MessageId: string }>,
  fn: (calls: SqsCall[]) => Promise<T>,
): Promise<T> {
  const calls: SqsCall[] = [];
  const originalSend = SQSClient.prototype.send;
  // deno-lint-ignore no-explicit-any
  (SQSClient.prototype as any).send = function (command: any) {
    calls.push({ command });
    const cmdName = command?.constructor?.name;
    if (cmdName === "ReceiveMessageCommand") {
      const next = queue.shift();
      return Promise.resolve(next ? { Messages: [next] } : { Messages: [] });
    }
    if (cmdName === "DeleteMessageCommand") {
      return Promise.resolve({});
    }
    if (
      cmdName === "SendMessageCommand" ||
      cmdName === "SendMessageBatchCommand"
    ) {
      return Promise.resolve({});
    }
    return Promise.resolve({});
  };
  return fn(calls).finally(() => {
    SQSClient.prototype.send = originalSend;
  });
}

Deno.test("sqs-queue: receive() drops poison message and continues", async () => {
  // Suppress structured error logging during the test to keep output clean.
  const originalError = console.error;
  console.error = () => {};
  try {
    const adapter = createSqsQueue({
      region: "us-east-1",
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      queueName: "test-queue" as never,
    });
    assert(adapter.receive);

    await withMockedSqs(
      [
        // First receive: poison (invalid JSON).
        {
          Body: "{not json",
          ReceiptHandle: "poison-handle",
          MessageId: "poison-1",
        },
      ],
      async (calls) => {
        const record = await adapter.receive!();
        // Poison message should result in null (not a throw).
        assertEquals(record, null);
        // Receive + Delete (of the poison) should both have been issued.
        const cmdNames = calls.map((c) => c.command.constructor.name);
        assertEquals(cmdNames.includes("ReceiveMessageCommand"), true);
        assertEquals(cmdNames.includes("DeleteMessageCommand"), true);
        // The delete must target the poison ReceiptHandle so SQS removes it
        // from the queue (so it does not redeliver forever).
        const deleteCmd = calls.find((c) =>
          c.command.constructor.name === "DeleteMessageCommand"
        );
        assert(deleteCmd);
        assertEquals(deleteCmd.command.input.ReceiptHandle, "poison-handle");
      },
    );
  } finally {
    console.error = originalError;
  }
});

Deno.test("sqs-queue: receive() returns parsed body for well-formed message", async () => {
  const adapter = createSqsQueue<{ hello: string }>({
    region: "us-east-1",
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
    queueName: "test-queue" as never,
  });
  assert(adapter.receive);

  await withMockedSqs(
    [
      {
        Body: JSON.stringify({ hello: "world" }),
        ReceiptHandle: "good-handle",
        MessageId: "good-1",
      },
    ],
    async () => {
      const record = await adapter.receive!();
      assert(record);
      assertEquals(record.body, { hello: "world" });
    },
  );
});
