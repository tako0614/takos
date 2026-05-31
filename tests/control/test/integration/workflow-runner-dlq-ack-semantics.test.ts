import {
  type Env,
  WORKFLOW_QUEUE_MESSAGE_VERSION,
} from "@/shared/types/index.ts";

import { strict as assert } from "node:assert";
import { mock, test } from "bun:test";

import workflowRunner from "@/runtime/queues/workflow-runner.ts";

type DlqBatch = Parameters<typeof workflowRunner.queue>[0];
type MessageQueueMessage = DlqBatch["messages"][number];

function createDlqBatch(message: MessageQueueMessage): DlqBatch {
  return {
    queue: "takos-workflow-jobs-dlq",
    messages: [message],
    // The runner never invokes ackAll / retryAll on this batch — the test
    // exercises per-message ack/retry. Provide typed no-op stubs that match
    // the batch contract so a stray invocation is a deterministic no-op.
    ackAll: () => {},
    retryAll: (_options?: { delaySeconds?: number }) => {},
  } satisfies DlqBatch;
}

function createMessageQueueMessage(runId: string, attempts: number) {
  return {
    id: `msg-${runId}`,
    timestamp: new Date("2026-03-09T00:00:00Z"),
    body: {
      version: WORKFLOW_QUEUE_MESSAGE_VERSION,
      type: "job",
      runId,
      jobId: `job-${runId}`,
      repoId: `repo-${runId}`,
      ref: "refs/heads/main",
      sha: "0123456789abcdef0123456789abcdef01234567",
      jobKey: `deploy-${runId}`,
      jobDefinition: {},
      env: {},
      secretIds: [],
      timestamp: Date.now(),
    },
    attempts,
    ack: mock(() => undefined),
    retry: mock(() => undefined),
  } satisfies MessageQueueMessage;
}

test("workflow-runner DLQ ack semantics - acks invalid DLQ messages after the handler returns", async () => {
  const message = {
    ...createMessageQueueMessage("run-1", 1),
    body: { runId: "run-1" },
  } satisfies MessageQueueMessage;

  await workflowRunner.queue(
    createDlqBatch(message),
    { DB: {} } as Env,
  );

  assert.deepStrictEqual(message.ack.mock.calls.length, 1);
  assert.deepStrictEqual(message.retry.mock.calls.length, 0);
});

test("workflow-runner DLQ ack semantics - retries DLQ messages when handler processing throws", async () => {
  const message = createMessageQueueMessage("run-2", 2);

  await workflowRunner.queue(
    createDlqBatch(message),
    { DB: {} } as Env,
  );

  assert.deepStrictEqual(message.retry.mock.calls.length, 1);
  assert.deepStrictEqual(message.ack.mock.calls.length, 0);
});
