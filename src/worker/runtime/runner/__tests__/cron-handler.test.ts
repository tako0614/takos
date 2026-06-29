import { test } from "bun:test";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { assertEquals, assertStringIncludes } from "@takos/test/assert";

import {
  cronHandlerDeps,
  reenqueueStaleRunningRuns,
  reenqueueStaleUnclaimedRuns,
} from "../cron-handler.ts";
import { RUN_QUEUE_MESSAGE_VERSION } from "../../../shared/types/index.ts";

// Stub model resolution so the cron re-enqueue is deterministic and does not hit
// the space-model query (the real resolveRunModel reads the workspace default).
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
      rawRows: [["run-queued", "acct-1", "queued"], [
        "run-pending",
        "acct-2",
        "pending",
      ]],
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
      model: "test-model",
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
  const { db, prepareCalls } = createFakeSqlDatabaseBinding([
    { rawRows: [] },
  ]);
  const env = createEnv(db);

  await reenqueueStaleUnclaimedRuns(env, "2026-04-01T00:00:00.000Z");

  assertEquals(env.sentMessages, []);
  assertEquals(prepareCalls.length, 1);
});

test("reenqueueStaleRunningRuns reverts to stale running when queue send fails", async () => {
  const { db, prepareCalls } = createFakeSqlDatabaseBinding([
    { rawRows: [["run-running", "acct-1"]] },
    { run: { meta: { changes: 1 } } },
    { run: { meta: { changes: 1 } } },
  ]);
  const env = createEnv(db, { sendError: new Error("queue unavailable") });

  await reenqueueStaleRunningRuns(env, "2026-04-01T00:00:00.000Z");

  assertEquals(
    env.sentMessages.map((message) => (message as { runId: string }).runId),
    ["run-running"],
  );
  assertEquals(prepareCalls.length, 3);
  assertStringIncludes(prepareCalls[2].sql.toLowerCase(), "update");
});
