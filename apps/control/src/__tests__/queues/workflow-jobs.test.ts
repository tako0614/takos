import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  type WorkflowJobQueueMessage,
} from "@/types";

import { assert, assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import type { D1Database } from "@cloudflare/workers-types";
import { createWorkflowQueueConsumer } from "@/queues/workflow-jobs";
import type { WorkflowQueueEnv } from "../../../../../packages/control/src/runtime/queues/workflow-types.ts";

type QueueMessage = {
  body: unknown;
  ack: any;
  retry: any;
};

function createQueueMessage(body: unknown): QueueMessage {
  return {
    body,
    ack: spy(() => {}),
    retry: spy(() => {}),
  };
}

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

function createWorkflowDbMock(
  selectRows: Array<Record<string, unknown> | null>,
) {
  const selectQueue = [...selectRows];
  const queries: Array<{ sql: string; args: unknown[] }> = [];

  const makeBound = (sql: string) => {
    const normalized = sql.trim().toLowerCase();
    const row = normalized.startsWith("select")
      ? selectQueue.shift() ?? null
      : null;

    return {
      get: async () => row,
      first: async () => row,
      all: async () => (row ? [row] : []),
      raw: async () => (row ? [Object.values(row)] : []),
      run: async () => ({
        success: true,
        meta: { changes: normalized.startsWith("select") ? (row ? 1 : 0) : 1 },
      }),
    };
  };

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          queries.push({ sql, args });
          return makeBound(sql);
        },
      };
    },
  } as unknown as D1Database;

  return { db, queries };
}

function createWorkflowEnv(
  overrides: Partial<WorkflowQueueEnv> = {},
): WorkflowQueueEnv {
  const db = createWorkflowDbMock([
    { status: "running" },
    { status: "completed" },
  ]).db;

  return {
    DB: db,
    GIT_OBJECTS: {} as any,
    RUN_NOTIFIER: {} as any,
    ...overrides,
  } as WorkflowQueueEnv;
}

Deno.test("createWorkflowQueueConsumer - creates a consumer with a queue method", () => {
  const consumer = createWorkflowQueueConsumer(createWorkflowEnv());
  assert(consumer !== undefined);
  assertEquals(typeof consumer.queue, "function");
});

Deno.test("createWorkflowQueueConsumer - acks invalid messages without processing", async () => {
  const consumer = createWorkflowQueueConsumer(createWorkflowEnv());
  const msg = createQueueMessage({ invalid: true });

  await consumer.queue({ messages: [msg] });

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
});

Deno.test("createWorkflowQueueConsumer - acks a valid message when the handler exits cleanly", async () => {
  const { db, queries } = createWorkflowDbMock([
    { status: "completed" },
    { status: "queued" },
  ]);
  const consumer = createWorkflowQueueConsumer(
    {
      DB: db,
      GIT_OBJECTS: {} as any,
      RUN_NOTIFIER: {} as any,
    } as WorkflowQueueEnv,
  );
  const msg = createQueueMessage(createWorkflowMessage());

  await consumer.queue({ messages: [msg] });

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
  assert(queries.some((query) => query.sql.toLowerCase().includes("update")));
});

Deno.test("createWorkflowQueueConsumer - retries on handler failure", async () => {
  const consumer = createWorkflowQueueConsumer(
    {
      DB: {} as D1Database,
      RUN_NOTIFIER: {} as any,
    } as WorkflowQueueEnv,
  );
  const msg = createQueueMessage(createWorkflowMessage());

  await consumer.queue({ messages: [msg] });

  assertSpyCalls(msg.ack, 0);
  assertSpyCalls(msg.retry, 1);
});

Deno.test("createWorkflowQueueConsumer - continues processing after an invalid message", async () => {
  const { db } = createWorkflowDbMock([
    { status: "completed" },
    { status: "queued" },
  ]);
  const consumer = createWorkflowQueueConsumer(
    {
      DB: db,
      GIT_OBJECTS: {} as any,
      RUN_NOTIFIER: {} as any,
    } as WorkflowQueueEnv,
  );
  const invalid = createQueueMessage({ invalid: true });
  const valid = createQueueMessage(createWorkflowMessage());

  await consumer.queue({ messages: [invalid, valid] });

  assertSpyCalls(invalid.ack, 1);
  assertSpyCalls(valid.ack, 1);
  assertSpyCalls(valid.retry, 0);
});

Deno.test("createWorkflowQueueConsumer - handles empty batch", async () => {
  const consumer = createWorkflowQueueConsumer(createWorkflowEnv());
  assertEquals(await consumer.queue({ messages: [] }), undefined);
});
