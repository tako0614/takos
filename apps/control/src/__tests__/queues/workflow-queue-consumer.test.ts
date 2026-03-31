import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  type WorkflowJobQueueMessage,
} from "@/types";
import { createWorkflowQueueConsumer } from "@/queues/workflow-jobs";
import type { WorkflowQueueEnv } from "@/queues/workflow-types";

type QueryRow = Record<string, unknown> | null;

function createWorkflowMessage(
  overrides: Partial<WorkflowJobQueueMessage> = {},
): WorkflowJobQueueMessage {
  return {
    version: WORKFLOW_QUEUE_MESSAGE_VERSION,
    type: "job",
    runId: "run-1",
    jobId: "job-1",
    repoId: "repo-1",
    ref: "refs/heads/main",
    sha: "a".repeat(40),
    jobKey: "build",
    jobDefinition: {
      name: "Build",
      "runs-on": "ubuntu-latest",
      steps: [{ run: "echo ok" }],
    },
    env: { CI: "true" },
    secretIds: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function createFakeD1(
  selectRows: QueryRow[] = [],
  runChanges: number[] = [],
) {
  const pendingSelectRows = [...selectRows];
  const pendingRunChanges = [...runChanges];

  return {
    db: {
      prepare(sql: string) {
        const normalized = sql.trim().toLowerCase();
        const row = normalized.startsWith("select")
          ? pendingSelectRows.shift() ?? null
          : null;

        return {
          bind(..._args: unknown[]) {
            return {
              raw: async () => (row ? [Object.values(row)] : []),
              first: async () => row,
              all: async () => ({ results: row ? [row] : [] }),
              run: async () => ({
                success: true,
                meta: { changes: pendingRunChanges.shift() ?? 1 },
              }),
            };
          },
        };
      },
    } as unknown as D1Database,
  };
}

function createRunNotifier() {
  const fetchSpy = spy(async () => new Response(null, { status: 204 }));

  return {
    fetchSpy,
    namespace: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: fetchSpy }),
    } as WorkflowQueueEnv["RUN_NOTIFIER"],
  };
}

function createEnv(
  overrides: Partial<WorkflowQueueEnv> = {},
): WorkflowQueueEnv {
  const { db } = createFakeD1();
  const { namespace } = createRunNotifier();

  return {
    DB: db,
    GIT_OBJECTS: {} as WorkflowQueueEnv["GIT_OBJECTS"],
    RUN_NOTIFIER: namespace,
    ...overrides,
  } as WorkflowQueueEnv;
}

function createBatchMessage(body: unknown) {
  return {
    body,
    ack: spy(() => {}),
    retry: spy(() => {}),
  };
}

Deno.test("createWorkflowQueueConsumer - exposes a queue handler", () => {
  const consumer = createWorkflowQueueConsumer(createEnv());

  assertEquals(typeof consumer.queue, "function");
});

Deno.test("createWorkflowQueueConsumer - acks invalid messages", async () => {
  const consumer = createWorkflowQueueConsumer(createEnv());
  const invalidMessage = createBatchMessage({ invalid: true });

  await consumer.queue({ messages: [invalidMessage] });

  assertSpyCalls(invalidMessage.ack, 1);
  assertSpyCalls(invalidMessage.retry, 0);
});

Deno.test("createWorkflowQueueConsumer - retries valid messages when the handler throws", async () => {
  const consumer = createWorkflowQueueConsumer(
    createEnv({
      DB: {} as D1Database,
      GIT_OBJECTS: undefined,
    }),
  );
  const message = createBatchMessage(createWorkflowMessage());

  await consumer.queue({ messages: [message] });

  assertSpyCalls(message.ack, 0);
  assertSpyCalls(message.retry, 1);
});

Deno.test("createWorkflowQueueConsumer - acks valid messages when the handler exits cleanly", async () => {
  const { db } = createFakeD1([
    { status: "completed" },
    { status: "queued" },
  ]);
  const { namespace } = createRunNotifier();
  const consumer = createWorkflowQueueConsumer({
    DB: db,
    GIT_OBJECTS: {} as WorkflowQueueEnv["GIT_OBJECTS"],
    RUN_NOTIFIER: namespace,
  } as WorkflowQueueEnv);
  const message = createBatchMessage(createWorkflowMessage());

  await consumer.queue({ messages: [message] });

  assertSpyCalls(message.ack, 1);
  assertSpyCalls(message.retry, 0);
});

Deno.test("createWorkflowQueueConsumer - continues after an invalid message", async () => {
  const { db } = createFakeD1([
    { status: "completed" },
    { status: "queued" },
  ]);
  const { namespace } = createRunNotifier();
  const consumer = createWorkflowQueueConsumer({
    DB: db,
    GIT_OBJECTS: {} as WorkflowQueueEnv["GIT_OBJECTS"],
    RUN_NOTIFIER: namespace,
  } as WorkflowQueueEnv);
  const invalidMessage = createBatchMessage({ invalid: true });
  const validMessage = createBatchMessage(createWorkflowMessage());

  await consumer.queue({ messages: [invalidMessage, validMessage] });

  assertSpyCalls(invalidMessage.ack, 1);
  assertSpyCalls(validMessage.ack, 1);
  assertSpyCalls(validMessage.retry, 0);
});
