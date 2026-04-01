import {
  type Env,
  WORKFLOW_QUEUE_MESSAGE_VERSION,
} from "@/shared/types/index.ts";

import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import workflowRunner from "@/runtime/queues/workflow-runner.ts";

type DlqBatch = Parameters<typeof workflowRunner.queue>[0];
type QueueMessage = DlqBatch["messages"][number];

function createDlqBatch(message: QueueMessage): DlqBatch {
  return {
    queue: "takos-workflow-jobs-dlq",
    messages: [message],
    ackAll: ((..._args: any[]) => undefined) as any,
    retryAll: ((..._args: any[]) => undefined) as any,
  } satisfies DlqBatch;
}

function createQueueMessage(runId: string, attempts: number) {
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
  } satisfies QueueMessage;
}

Deno.test("workflow-runner DLQ ack semantics - acks invalid DLQ messages after the handler returns", async () => {
  const message = {
    ...createQueueMessage("run-1", 1),
    body: { runId: "run-1" },
  } satisfies QueueMessage;

  await workflowRunner.queue(
    createDlqBatch(message),
    { DB: {} } as Env,
  );

  assertSpyCalls(message.ack, 1);
  assertSpyCalls(message.retry, 0);
});

Deno.test("workflow-runner DLQ ack semantics - retries DLQ messages when handler processing throws", async () => {
  const message = createQueueMessage("run-2", 2);

  await workflowRunner.queue(
    createDlqBatch(message),
    { DB: {} } as Env,
  );

  assertSpyCalls(message.retry, 1);
  assertSpyCalls(message.ack, 0);
});
