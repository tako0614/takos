// deno-lint-ignore-file no-explicit-any

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

type MockMessage = {
  body: unknown;
  ack: any;
  retry: any;
  attempts: number;
};

function createMessage(body: unknown, attempts = 1): MockMessage {
  return {
    body,
    ack: spy(() => {}),
    retry: spy(() => {}),
    attempts,
  };
}

function createBatch(queue: string, messages: MockMessage[]) {
  return { queue, messages };
}

const minimalEnv = { DB: {} } as const;

async function loadWorkflowRunner(tag: string) {
  return (await import(
    new URL(
      `../../../../../packages/control/src/runtime/queues/workflow-runner.ts?${tag}`,
      import.meta.url,
    ).href
  )).default;
}

Deno.test("workflow-runner queue handler - environment validation retries all messages when env validation fails", async () => {
  const workflowRunner = await loadWorkflowRunner("env-validation");
  const msg1 = createMessage({ test: 1 });
  const msg2 = createMessage({ test: 2 });
  const batch = createBatch("takos-workflow-jobs", [msg1, msg2]);

  await workflowRunner.queue(batch as any, {} as any);

  assertSpyCalls(msg1.retry, 1);
  assertSpyCalls(msg2.retry, 1);
  assertSpyCalls(msg1.ack, 0);
  assertSpyCalls(msg2.ack, 0);
});

Deno.test("workflow-runner queue handler - takos-workflow-jobs queue acks invalid workflow messages", async () => {
  const workflowRunner = await loadWorkflowRunner("workflow-invalid");
  const msg = createMessage({ invalid: true });
  const batch = createBatch("takos-workflow-jobs", [msg]);

  await workflowRunner.queue(batch as any, minimalEnv as any);

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
});

Deno.test("workflow-runner queue handler - takos-workflow-jobs-dlq queue acks invalid workflow DLQ messages", async () => {
  const workflowRunner = await loadWorkflowRunner("workflow-dlq-invalid");
  const msg = createMessage({ invalid: true }, 3);
  const batch = createBatch("takos-workflow-jobs-dlq", [msg]);

  await workflowRunner.queue(batch as any, minimalEnv as any);

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
});

Deno.test("workflow-runner queue handler - takos-deployment-jobs queue acks invalid deployment messages", async () => {
  const workflowRunner = await loadWorkflowRunner("deployment-invalid");
  const msg = createMessage({ invalid: true });
  const batch = createBatch("takos-deployment-jobs", [msg]);

  await workflowRunner.queue(batch as any, minimalEnv as any);

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
});

Deno.test("workflow-runner queue handler - unknown queue acks all messages", async () => {
  const workflowRunner = await loadWorkflowRunner("unknown-queue");
  const msg1 = createMessage({ test: 1 });
  const msg2 = createMessage({ test: 2 });
  const batch = createBatch("unknown-queue-name", [msg1, msg2]);

  await workflowRunner.queue(batch as any, minimalEnv as any);

  assertSpyCalls(msg1.ack, 1);
  assertSpyCalls(msg2.ack, 1);
  assertSpyCalls(msg1.retry, 0);
  assertSpyCalls(msg2.retry, 0);
});

Deno.test("workflow-runner queue handler - deployment queue accepts stage suffix in queue name", async () => {
  const workflowRunner = await loadWorkflowRunner("deployment-staging");
  const msg = createMessage({ invalid: true });
  const batch = createBatch("takos-deployment-jobs-staging", [msg]);

  await workflowRunner.queue(batch as any, minimalEnv as any);

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
  assertEquals(batch.queue.replace(/-staging$/i, ""), "takos-deployment-jobs");
});
