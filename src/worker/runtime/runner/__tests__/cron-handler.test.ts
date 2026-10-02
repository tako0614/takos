import { test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { assertEquals, assertStringIncludes } from "@takos/test/assert";
import * as schema from "../../../infra/db/schema.ts";
import type { Database } from "../../../infra/db/client.ts";

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

test("sequential stale selectors send one Run message and preserve the Run witness", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        requester_account_id TEXT,
        thread_id TEXT,
        model TEXT,
        status TEXT NOT NULL,
        service_id TEXT,
        service_heartbeat TEXT,
        lease_version INTEGER NOT NULL,
        engine_checkpoint TEXT,
        completion_key TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO runs (
        id, account_id, requester_account_id, thread_id, model, status, service_id,
        service_heartbeat, lease_version, engine_checkpoint, created_at
      ) VALUES (
        'stale-run', 'workspace-1', 'owner-1', 'thread-1', 'saved-model', 'running',
        'old-service', '2026-03-01T00:00:00.000Z', 7,
        '{"opaque":{"checkpoint":"keep"}}', '2026-03-01T00:00:00.000Z'
      );
    `);
    const db = drizzle(client, { schema }) as unknown as Database;
    const sentMessages: unknown[] = [];
    const env = {
      DB: db,
      RUN_NOTIFIER: {} as RunnerEnv["RUN_NOTIFIER"],
      EXECUTOR_HOST: { fetch: async () => new Response(null, { status: 202 }) },
      RUN_QUEUE: { send: async (message: unknown) => { sentMessages.push(message); } },
    } as unknown as RunnerEnv;
    const staleThreshold = "2026-04-01T00:00:00.000Z";

    await reenqueueStaleRunningRuns(env, staleThreshold);
    await reenqueueStaleUnclaimedRuns(env, staleThreshold);

    const readRun = async (): Promise<Record<string, unknown>> => {
      const row = (await client.execute({
        sql: `SELECT id, account_id, requester_account_id, thread_id, status, service_id,
                    service_heartbeat, lease_version, engine_checkpoint
             FROM runs WHERE id = ?`,
        args: ["stale-run"],
      })).rows[0];
      if (!row) throw new Error("stale Run readback row is missing");
      return Object.fromEntries(Object.entries(row));
    };
    const afterBothSelectors = await readRun();
    assertEquals(sentMessages.length, 1);
    assertEquals((sentMessages[0] as { runId: string }).runId, "stale-run");
    const recoveryHeartbeat = afterBothSelectors.service_heartbeat;
    if (typeof recoveryHeartbeat !== "string") {
      throw new Error("stale Run recovery heartbeat is not a string");
    }
    assertEquals(afterBothSelectors, {
      id: "stale-run",
      account_id: "workspace-1",
      requester_account_id: "owner-1",
      thread_id: "thread-1",
      status: "queued",
      service_id: null,
      service_heartbeat: recoveryHeartbeat,
      lease_version: 7,
      engine_checkpoint: '{"opaque":{"checkpoint":"keep"}}',
    });
    assertEquals(Date.parse(recoveryHeartbeat) > Date.parse(staleThreshold), true);

    // The recovery heartbeat is a cooldown, not a permanent delivery lock.
    const afterCooldown = new Date(Date.parse(recoveryHeartbeat) + 1).toISOString();
    await reenqueueStaleUnclaimedRuns(env, afterCooldown);
    assertEquals(sentMessages.length, 2);
    const afterRetry = await readRun();
    assertEquals(afterRetry.account_id, "workspace-1");
    assertEquals(afterRetry.requester_account_id, "owner-1");
    assertEquals(afterRetry.thread_id, "thread-1");
    assertEquals(afterRetry.lease_version, 7);
    assertEquals(afterRetry.engine_checkpoint, '{"opaque":{"checkpoint":"keep"}}');

    // Model the Queue consumer winning the claim before a later recovery pass.
    await client.execute({
      sql: `UPDATE runs SET status = 'running', service_id = ?, service_heartbeat = ?,
                            lease_version = lease_version + 1 WHERE id = ? AND status = 'queued'`,
      args: ["new-service", new Date().toISOString(), "stale-run"],
    });
    await reenqueueStaleUnclaimedRuns(
      env,
      new Date(Date.now() + 60_000).toISOString(),
    );
    assertEquals(sentMessages.length, 2);
    const afterClaim = await readRun();
    assertEquals(afterClaim.status, "running");
    assertEquals(afterClaim.service_id, "new-service");
    assertEquals(afterClaim.lease_version, 8);
  } finally {
    await client.close();
  }
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
  assertEquals(prepareCalls.length, 4);
  assertStringIncludes(prepareCalls[0].sql.toLowerCase(), "index_jobs");
  assertStringIncludes(prepareCalls[1].sql.toLowerCase(), "update");
  assertStringIncludes(
    prepareCalls[2].sql.toLowerCase(),
    "run_notification_outbox",
  );
  assertStringIncludes(
    prepareCalls[3].sql.toLowerCase(),
    "run_usage_projection_outbox",
  );
});

test("scheduled usage recovery runs without INDEX_QUEUE and EXECUTOR_HOST", async () => {
  const { db, prepareCalls } = createFakeSqlDatabaseBinding([
    { rawRows: [] }, { rawRows: [] }, { rawRows: [] },
  ]);
  const env = {
    DB: db,
    RUN_NOTIFIER: {},
    RUN_QUEUE: { send: async () => {} },
  } as unknown as RunnerEnv;
  await handleScheduled({} as never, env);
  assertEquals(prepareCalls.some((call) =>
    call.sql.includes("run_usage_projection_outbox")), true);
});
