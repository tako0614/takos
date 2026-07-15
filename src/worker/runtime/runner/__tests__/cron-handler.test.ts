import { test } from "bun:test";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { assertEquals, assertStringIncludes } from "@takos/test/assert";

import {
  cronHandlerDeps,
  handleScheduled,
  reenqueueStaleRunningRuns,
  reenqueueStaleUnclaimedRuns,
} from "../cron-handler.ts";
import {
  INDEX_QUEUE_MESSAGE_VERSION,
  RUN_QUEUE_MESSAGE_VERSION,
} from "../../../shared/types/index.ts";

// Stub legacy-row model resolution so the cron re-enqueue is deterministic and
// does not hit the Workspace model query.
cronHandlerDeps.resolveRunModel = async () => "test-model";
import type { RunnerEnv } from "../../../shared/types/index.ts";

type FakeResponse = {
  rawRows?: unknown[][];
  run?: { meta: { changes: number } };
};

type PrepareCall = {
  sql: string;
  args: unknown[];
};

function createFakeSqlDatabaseBinding(responses: FakeResponse[]) {
  const prepareCalls: PrepareCall[] = [];
  let index = 0;

  const db = {
    prepare(sql: string) {
      const response = responses[index++] ?? {};
      return {
        bind(...args: unknown[]) {
          prepareCalls.push({ sql, args });
          return {
            raw: async () => response.rawRows ?? [],
            first: async () => null,
            run: async () => response.run ?? { meta: { changes: 1 } },
            all: async () => response.rawRows ?? [],
          };
        },
      };
    },
  } as unknown as SqlDatabaseBinding;

  return { db, prepareCalls };
}

function createEnv(
  db: SqlDatabaseBinding,
  options?: { sendError?: Error },
): RunnerEnv & { sentMessages: unknown[] } {
  const sentMessages: unknown[] = [];
  return {
    DB: db,
    RUN_NOTIFIER: {} as RunnerEnv["RUN_NOTIFIER"],
    EXECUTOR_HOST: { fetch: async () => new Response(null, { status: 202 }) },
    RUN_QUEUE: {
      send: async (message: unknown) => {
        sentMessages.push(message);
        if (options?.sendError) {
          throw options.sendError;
        }
      },
    } as RunnerEnv["RUN_QUEUE"],
    sentMessages,
  } as RunnerEnv & { sentMessages: unknown[] };
}

test("reenqueueStaleUnclaimedRuns re-enqueues stale pending and queued runs", async () => {
  const { db, prepareCalls } = createFakeSqlDatabaseBinding([
    {
      rawRows: [
        ["run-queued", "acct-1", "queued", "saved-model"],
        ["run-pending", "acct-2", "pending", null],
      ],
    },
    { run: { meta: { changes: 1 } } },
    { run: { meta: { changes: 1 } } },
  ]);
  const env = createEnv(db);

  await reenqueueStaleUnclaimedRuns(env, "2026-04-01T00:00:00.000Z");

  assertEquals(env.sentMessages, [
    {
      version: RUN_QUEUE_MESSAGE_VERSION,
      runId: "run-queued",
      model: "saved-model",
      timestamp: (env.sentMessages[0] as { timestamp: number }).timestamp,
      retryCount: 0,
    },
    {
      version: RUN_QUEUE_MESSAGE_VERSION,
      runId: "run-pending",
      model: "test-model",
      timestamp: (env.sentMessages[1] as { timestamp: number }).timestamp,
      retryCount: 0,
    },
  ]);
  assertEquals(prepareCalls.length, 3);
  assertStringIncludes(prepareCalls[0].sql.toLowerCase(), "select");
  assertStringIncludes(prepareCalls[1].sql.toLowerCase(), "update");
  assertStringIncludes(prepareCalls[2].sql.toLowerCase(), "update");
});

test("reenqueueStaleUnclaimedRuns leaves fresh queues untouched when no rows match", async () => {
  const { db, prepareCalls } = createFakeSqlDatabaseBinding([{ rawRows: [] }]);
  const env = createEnv(db);

  await reenqueueStaleUnclaimedRuns(env, "2026-04-01T00:00:00.000Z");

  assertEquals(env.sentMessages, []);
  assertEquals(prepareCalls.length, 1);
});

test("reenqueueStaleRunningRuns reverts to stale running when queue send fails", async () => {
  const { db, prepareCalls } = createFakeSqlDatabaseBinding([
    { rawRows: [["run-running", "acct-1", "saved-running-model"]] },
    { run: { meta: { changes: 1 } } },
    { run: { meta: { changes: 1 } } },
  ]);
  const env = createEnv(db, { sendError: new Error("queue unavailable") });

  await reenqueueStaleRunningRuns(env, "2026-04-01T00:00:00.000Z");

  assertEquals(
    env.sentMessages.map((message) => ({
      runId: (message as { runId: string }).runId,
      model: (message as { model: string }).model,
    })),
    [{ runId: "run-running", model: "saved-running-model" }],
  );
  assertEquals(prepareCalls.length, 3);
  assertStringIncludes(prepareCalls[2].sql.toLowerCase(), "update");
});

test("scheduled recovery dispatches the durable terminal index outbox independently", async () => {
  const { db, prepareCalls } = createFakeSqlDatabaseBinding([
    {
      rawRows: [
        [
          "index-outbox:agent-complete:test:info_unit",
          "acct-1",
          "info_unit",
          "run-1",
          "queued",
        ],
      ],
    },
    { run: { meta: { changes: 1 } } },
  ]);
  const sentMessages: unknown[] = [];
  const env = {
    DB: db,
    RUN_QUEUE: { send: async () => {} },
    RUN_NOTIFIER: {},
    INDEX_QUEUE: {
      send: async (message: unknown) => {
        sentMessages.push(message);
      },
    },
    // Deliberately omit EXECUTOR_HOST: index outbox recovery does not depend on
    // agent-container stale-run recovery being configured.
  } as unknown as RunnerEnv;

  await handleScheduled({} as never, env);

  assertEquals(sentMessages.length, 1);
  assertEquals(sentMessages[0], {
    version: INDEX_QUEUE_MESSAGE_VERSION,
    jobId: "index-outbox:agent-complete:test:info_unit",
    deliveryId: (sentMessages[0] as { deliveryId: string }).deliveryId,
    spaceId: "acct-1",
    type: "info_unit",
    targetId: "run-1",
    timestamp: (sentMessages[0] as { timestamp: number }).timestamp,
  });
  assertEquals(prepareCalls.length, 3);
  assertStringIncludes(prepareCalls[0].sql.toLowerCase(), "index_jobs");
  assertStringIncludes(prepareCalls[1].sql.toLowerCase(), "update");
  assertStringIncludes(
    prepareCalls[2].sql.toLowerCase(),
    "run_notification_outbox",
  );
});
