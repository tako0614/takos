import { assert, assertEquals } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls } from "jsr:@std/testing/mock";

const mocks = {
  handleWorkflowJob: ((..._args: any[]) => undefined) as any,
  isValidWorkflowJobQueueMessage: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/queues/workflow-job-handler'
// [Deno] vi.mock removed - manually stub imports from '@/types'
import { createWorkflowQueueConsumer } from "@/queues/workflow-jobs";
import type { WorkflowQueueEnv } from "@/queues/workflow-types";

function createMockEnv(): WorkflowQueueEnv {
  return {
    DB: {} as any,
    RUN_NOTIFIER: {} as any,
  } as unknown as WorkflowQueueEnv;
}

interface MockBatchMessage {
  body: unknown;
  ack: any;
  retry: any;
}

function createBatchMessage(body: unknown): MockBatchMessage {
  return {
    body,
    ack: ((..._args: any[]) => undefined) as any,
    retry: ((..._args: any[]) => undefined) as any,
  };
}

Deno.test("createWorkflowQueueConsumer - creates a consumer with a queue method", () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const consumer = createWorkflowQueueConsumer(createMockEnv());
  assert(consumer !== undefined);
  assertEquals(typeof consumer.queue, "function");
});
Deno.test("createWorkflowQueueConsumer - acks invalid messages without processing", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isValidWorkflowJobQueueMessage = (() => false) as any;

  const consumer = createWorkflowQueueConsumer(createMockEnv());
  const msg = createBatchMessage({ invalid: true });

  await consumer.queue({ messages: [msg] });

  assert(msg.ack.calls.length > 0);
  assertSpyCalls(mocks.handleWorkflowJob, 0);
});
Deno.test("createWorkflowQueueConsumer - processes valid messages and acks on success", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;
  mocks.handleWorkflowJob = (async () => undefined) as any;

  const consumer = createWorkflowQueueConsumer(createMockEnv());
  const msg = createBatchMessage({ type: "job", runId: "r1" });

  await consumer.queue({ messages: [msg] });

  assertSpyCallArgs(mocks.handleWorkflowJob, 0, [msg.body, expect.anything()]);
  assert(msg.ack.calls.length > 0);
});
Deno.test("createWorkflowQueueConsumer - retries on handler failure", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;
  mocks.handleWorkflowJob = (async () => {
    throw new Error("handler crashed");
  }) as any;

  const consumer = createWorkflowQueueConsumer(createMockEnv());
  const msg = createBatchMessage({ type: "job" });

  await consumer.queue({ messages: [msg] });

  assert(msg.retry.calls.length > 0);
  assertSpyCalls(msg.ack, 0);
});
Deno.test("createWorkflowQueueConsumer - processes batch of mixed valid/invalid messages", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isValidWorkflowJobQueueMessage =
    (() => false) as any =
    (() => true) as any =
      (() => false) as any;
  mocks.handleWorkflowJob = (async () => undefined) as any;

  const consumer = createWorkflowQueueConsumer(createMockEnv());
  const msg1 = createBatchMessage({ invalid: true });
  const msg2 = createBatchMessage({ type: "job" });
  const msg3 = createBatchMessage({ also: "invalid" });

  await consumer.queue({ messages: [msg1, msg2, msg3] });

  assert(msg1.ack.calls.length > 0);
  assert(msg2.ack.calls.length > 0);
  assert(msg3.ack.calls.length > 0);
  assertSpyCalls(mocks.handleWorkflowJob, 1);
});
Deno.test("createWorkflowQueueConsumer - continues processing after one message fails", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;
  mocks.handleWorkflowJob =
    (async () => {
      throw new Error("first failed");
    }) as any =
      (async () => undefined) as any;

  const consumer = createWorkflowQueueConsumer(createMockEnv());
  const msg1 = createBatchMessage({ type: "job", runId: "1" });
  const msg2 = createBatchMessage({ type: "job", runId: "2" });

  await consumer.queue({ messages: [msg1, msg2] });

  assert(msg1.retry.calls.length > 0);
  assertSpyCalls(msg1.ack, 0);
  assert(msg2.ack.calls.length > 0);
  assertSpyCalls(msg2.retry, 0);
});
Deno.test("createWorkflowQueueConsumer - handles empty batch", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const consumer = createWorkflowQueueConsumer(createMockEnv());
  await assertEquals(await consumer.queue({ messages: [] }), undefined);
});
