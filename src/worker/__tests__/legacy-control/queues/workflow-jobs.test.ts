import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  type WorkflowJobQueueMessage,
} from "@/types";

import { assert, assertEquals } from "@std/assert";
import { assertSpyCalls, Spy, spy } from "@std/testing/mock";

import { createWorkflowQueueConsumer } from "@/queues/workflow-jobs";
import type { WorkflowQueueEnv } from "../../../runtime/queues/workflow-types.ts";
import {
  noopDurableObjectNamespace,
  noopObjectStoreBinding,
  noopSqlDatabaseBinding,
} from "@test/binding-stubs";
import { asTestSqlDatabaseBinding } from "@test/db-stubs";

// Queue message stubs only ever invoke `ack` / `retry` via the consumer, so
// we model them with concrete spy types instead of `any`.
type MessageQueueMessage = {
  body: unknown;
  ack: Spy<unknown, [], void>;
  retry: Spy<unknown, [], void>;
};

function createMessageQueueMessage(body: unknown): MessageQueueMessage {
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

  const db = asTestSqlDatabaseBinding({
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          queries.push({ sql, args });
          return makeBound(sql);
        },
      };
    },
  });

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
    GIT_OBJECTS: noopObjectStoreBinding(),
    RUN_NOTIFIER: noopDurableObjectNamespace(),
    ...overrides,
  };
}

Deno.test("createWorkflowQueueConsumer - creates a consumer with a queue method", () => {
  const consumer = createWorkflowQueueConsumer(createWorkflowEnv());
  assert(consumer !== undefined);
  assertEquals(typeof consumer.queue, "function");
});

Deno.test("createWorkflowQueueConsumer - acks invalid messages without processing", async () => {
  const consumer = createWorkflowQueueConsumer(createWorkflowEnv());
  const msg = createMessageQueueMessage({ invalid: true });

  await consumer.queue({ messages: [msg] });

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
});

Deno.test("createWorkflowQueueConsumer - acks a valid message when the handler exits cleanly", async () => {
  const { db, queries } = createWorkflowDbMock([
    { status: "completed" },
    { status: "queued" },
  ]);
  const consumer = createWorkflowQueueConsumer({
    DB: db,
    GIT_OBJECTS: noopObjectStoreBinding(),
    RUN_NOTIFIER: noopDurableObjectNamespace(),
  });
  const msg = createMessageQueueMessage(createWorkflowMessage());

  await consumer.queue({ messages: [msg] });

  assertSpyCalls(msg.ack, 1);
  assertSpyCalls(msg.retry, 0);
  assert(queries.some((query) => query.sql.toLowerCase().includes("update")));
});

Deno.test("createWorkflowQueueConsumer - retries on handler failure", async () => {
  const consumer = createWorkflowQueueConsumer({
    DB: noopSqlDatabaseBinding(),
    RUN_NOTIFIER: noopDurableObjectNamespace(),
  });
  const msg = createMessageQueueMessage(createWorkflowMessage());

  await consumer.queue({ messages: [msg] });

  assertSpyCalls(msg.ack, 0);
  assertSpyCalls(msg.retry, 1);
});

Deno.test("createWorkflowQueueConsumer - continues processing after an invalid message", async () => {
  const { db } = createWorkflowDbMock([
    { status: "completed" },
    { status: "queued" },
  ]);
  const consumer = createWorkflowQueueConsumer({
    DB: db,
    GIT_OBJECTS: noopObjectStoreBinding(),
    RUN_NOTIFIER: noopDurableObjectNamespace(),
  });
  const invalid = createMessageQueueMessage({ invalid: true });
  const valid = createMessageQueueMessage(createWorkflowMessage());

  await consumer.queue({ messages: [invalid, valid] });

  assertSpyCalls(invalid.ack, 1);
  assertSpyCalls(valid.ack, 1);
  assertSpyCalls(valid.retry, 0);
});

Deno.test("createWorkflowQueueConsumer - handles empty batch", async () => {
  const consumer = createWorkflowQueueConsumer(createWorkflowEnv());
  assertEquals(await consumer.queue({ messages: [] }), undefined);
});
