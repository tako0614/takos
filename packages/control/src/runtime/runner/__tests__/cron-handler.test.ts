import type { D1Database } from "@cloudflare/workers-types";
import { assertEquals, assertStringIncludes } from "@std/assert";

import {
  reenqueueStaleRunningRuns,
  reenqueueStaleUnclaimedRuns,
} from "../cron-handler.ts";
import { RUN_QUEUE_MESSAGE_VERSION } from "../../../shared/types/index.ts";
import type { RunnerEnv } from "../../../shared/types/index.ts";

type FakeResponse = {
  rawRows?: unknown[][];
  run?: { meta: { changes: number } };
};

type PrepareCall = {
  sql: string;
  args: unknown[];
};

function createFakeD1Database(responses: FakeResponse[]) {
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
  } as unknown as D1Database;

  return { db, prepareCalls };
}

function createEnv(
  db: D1Database,
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

Deno.test("reenqueueStaleUnclaimedRuns re-enqueues stale pending and queued runs", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    { rawRows: [["run-queued", "queued"], ["run-pending", "pending"]] },
    { run: { meta: { changes: 1 } } },
    { run: { meta: { changes: 1 } } },
  ]);
  const env = createEnv(db);

  await reenqueueStaleUnclaimedRuns(env, "2026-04-01T00:00:00.000Z");

  assertEquals(env.sentMessages, [
    {
      version: RUN_QUEUE_MESSAGE_VERSION,
      runId: "run-queued",
      timestamp: (env.sentMessages[0] as { timestamp: number }).timestamp,
      retryCount: 0,
    },
    {
      version: RUN_QUEUE_MESSAGE_VERSION,
      runId: "run-pending",
      timestamp: (env.sentMessages[1] as { timestamp: number }).timestamp,
      retryCount: 0,
    },
  ]);
  assertEquals(prepareCalls.length, 3);
  assertStringIncludes(prepareCalls[0].sql.toLowerCase(), "select");
  assertStringIncludes(prepareCalls[1].sql.toLowerCase(), "update");
  assertStringIncludes(prepareCalls[2].sql.toLowerCase(), "update");
});

Deno.test("reenqueueStaleUnclaimedRuns leaves fresh queues untouched when no rows match", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    { rawRows: [] },
  ]);
  const env = createEnv(db);

  await reenqueueStaleUnclaimedRuns(env, "2026-04-01T00:00:00.000Z");

  assertEquals(env.sentMessages, []);
  assertEquals(prepareCalls.length, 1);
});

Deno.test("reenqueueStaleRunningRuns reverts to stale running when queue send fails", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    { rawRows: [["run-running"]] },
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
