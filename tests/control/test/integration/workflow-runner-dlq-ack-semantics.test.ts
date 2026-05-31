import {
  type Env,
  WORKFLOW_QUEUE_MESSAGE_VERSION,
} from "@/shared/types/index.ts";

import { assertSpyCalls, spy } from "@std/testing/mock";

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
    ack: spy(() => undefined),
    retry: spy(() => undefined),
  } satisfies MessageQueueMessage;
}

Deno.test("workflow-runner DLQ ack semantics - acks invalid DLQ messages after the handler returns", async () => {
  const message = {
    ...createMessageQueueMessage("run-1", 1),
    body: { runId: "run-1" },
  } satisfies MessageQueueMessage;

  await workflowRunner.queue(
    createDlqBatch(message),
    { DB: {} } as Env,
  );

  assertSpyCalls(message.ack, 1);
  assertSpyCalls(message.retry, 0);
});

Deno.test("workflow-runner DLQ ack semantics - retries DLQ messages when handler processing throws", async () => {
  const message = createMessageQueueMessage("run-2", 2);

  await workflowRunner.queue(
    createDlqBatch(message),
    { DB: {} } as Env,
  );

  assertSpyCalls(message.retry, 1);
  assertSpyCalls(message.ack, 0);
});
