import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteSqlDatabase } from "../../../local-platform/persistent-d1.ts";
import type { ServerSqlDatabase } from "../../../local-platform/persistent-d1.ts";
import type {
  MessageQueueBatch,
  MessageQueueMessage,
} from "../../../shared/types/bindings.ts";
import type { WorkerEnv } from "../env.ts";
import { createWorkerRuntime } from "../runtime-factory.ts";
import type { ControlPlatform } from "../../../platform/platform-config.ts";
import { adaptEdgeSqlBinding } from "../../../platform/adapters/edge-sql.ts";
import { EMBEDDED_MIGRATIONS } from "../../../platform/migrations/migration-set.ts";
import {
  MIGRATION_LEDGER_TABLE,
  MIGRATION_LOCK_TABLE,
  runPendingMigrations,
} from "../../../platform/migrations/runtime-migrations.ts";
import { resetSchemaGate } from "../../../platform/migrations/schema-gate.ts";
import { createWebWorker } from "../../../web.ts";

let directory: string;
let databases: ServerSqlDatabase[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "takos-runtime-schema-admission-"));
  databases = [];
});

afterEach(async () => {
  for (const db of databases) {
    resetSchemaGate(db);
    try {
      db.close();
    } catch {
      // Already closed by the test.
    }
  }
  await rm(directory, { force: true, recursive: true });
});

async function openDatabase(name = "control.sqlite"): Promise<ServerSqlDatabase> {
  const db = await openSqliteSqlDatabase(join(directory, name));
  databases.push(db);
  return db;
}

const OLD_109 = EMBEDDED_MIGRATIONS.filter(
  (migration) => migration.name !== "0110_run_usage_projection_outbox.sql",
);

async function migrateOld109(db: ServerSqlDatabase): Promise<void> {
  const status = await runPendingMigrations(db, { migrations: OLD_109 });
  expect(status.state).toBe("ready");
  expect(status.applied).toBe(OLD_109.length);
}

async function seedQueuedRun(db: ServerSqlDatabase): Promise<void> {
  await db.prepare(
    `INSERT INTO accounts (id, type, status, name, slug)
     VALUES ('owner-1', 'user', 'active', 'Owner', 'owner-1')`,
  ).run();
  await db.prepare(
    `INSERT INTO accounts (id, type, status, name, slug, owner_account_id)
     VALUES ('workspace-1', 'space', 'active', 'Workspace', 'workspace-1', 'owner-1')`,
  ).run();
  await db.prepare(
    `INSERT INTO threads (id, account_id, title) VALUES ('thread-1', 'workspace-1', 'Thread')`,
  ).run();
  await db.prepare(
    `INSERT INTO runs (id, thread_id, account_id, status, error)
     VALUES ('run-1', 'thread-1', 'workspace-1', 'queued', 'prior failure')`,
  ).run();
}

type QueueCall = { action: "ack" } | { action: "retry"; delaySeconds?: number };

function queueBatch(
  queue: string,
  body?: unknown,
  messageCount = 1,
): { batch: MessageQueueBatch<unknown>; calls: QueueCall[] } {
  const calls: QueueCall[] = [];
  const defaultBody = queue.endsWith("runs") || queue.endsWith("runs-dlq")
    ? { version: 2, runId: "run-1", timestamp: Date.now() }
    : queue.endsWith("index-jobs") || queue.endsWith("index-jobs-dlq")
      ? { version: 1, jobId: "job-1", deliveryId: "delivery-1", spaceId: "workspace-1", type: "vectorize", timestamp: Date.now() }
      : { version: 1, notificationId: "notification-1", userId: "owner-1", scopeId: "workspace-1", timestamp: Date.now() };
  const messages = Array.from({ length: messageCount }, (_, index) => {
    const message: MessageQueueMessage<unknown> = {
      id: `message-${index + 1}`,
      timestamp: new Date(),
      body: body ?? defaultBody,
      attempts: 1,
      ack() {
        calls.push({ action: "ack" });
      },
      retry(options) {
        calls.push({ action: "retry", delaySeconds: options?.delaySeconds });
      },
    };
    return message;
  });
  return {
    batch: { queue, messages },
    calls,
  };
}

function workerEnv(db: unknown): WorkerEnv {
  return {
    DB: db as WorkerEnv["DB"],
    RUN_QUEUE: { async send() {} } as never,
    RUN_NOTIFIER: {
      idFromName(name: string) {
        return name;
      },
      get() {
        return { async fetch() { return new Response(null, { status: 200 }); } };
      },
    } as never,
    HOSTNAME_ROUTING: { async get() { return null; } } as never,
    EXECUTOR_HOST: { async fetch() { return new Response(null, { status: 200 }); } },
    ADMIN_DOMAIN: "admin.example.test",
    TENANT_BASE_DOMAIN: "tenant.example.test",
    OIDC_ISSUER_URL: "https://issuer.example.test",
    OIDC_OWNER_SUBJECT: "owner-subject",
  } as WorkerEnv;
}

function platformFor(
  env: WorkerEnv,
  source: "workers" | "node" = "workers",
): ControlPlatform<WorkerEnv> {
  return {
    source,
    bindings: env,
    config: { adminDomain: env.ADMIN_DOMAIN, tenantBaseDomain: env.TENANT_BASE_DOMAIN },
    services: {} as never,
  };
}

type TrackedDb = {
  db: unknown;
  domainSql: string[];
  failUsageOutboxMigration?: boolean;
};

/** Track or reject application SQL while forwarding all migration SQL to SQLite. */
function trackDb(db: ServerSqlDatabase, options: { failUsageOutboxMigration?: boolean } = {}): TrackedDb {
  const domainSql: string[] = [];
  const statementSql = new WeakMap<object, string>();
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string) => {
          const text = String(sql);
          if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE)\b/iu.test(text) &&
            !/(?:_takos_opentofu_migrations|_takos_runtime_migration_lock|d1_migrations|_takos_self_host_migrations|sqlite_master)/iu.test(text)) {
            domainSql.push(text);
          }
          const statement = target.prepare(sql);
          statementSql.set(statement, text);
          const originalBind = statement.bind;
          statement.bind = (...values: unknown[]) => {
            const bound = originalBind(...values);
            statementSql.set(bound, text);
            return bound;
          };
          return statement;
        };
      }
      if (property === "batch") {
        return (statements: object[]) => {
          if (options.failUsageOutboxMigration && statements.some((statement) =>
            statementSql.get(statement)?.includes('CREATE TABLE IF NOT EXISTS "run_usage_projection_outbox"'))) {
            throw new Error("injected 0110 DDL failure");
          }
          return target.batch(statements as never);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { db: proxy, domainSql, failUsageOutboxMigration: options.failUsageOutboxMigration };
}

const QUEUE_FAMILIES: string[] = [
  "takos-runs",
  "takos-runs-dlq",
  "takos-index-jobs",
  "takos-index-jobs-dlq",
  "takos-notification-push",
  "takos-notification-push-dlq",
];

describe("runtime schema admission", () => {
  test.each(QUEUE_FAMILIES)(
    "%s retries a real schema-109 database while another isolate holds migration claim",
    async (queue) => {
      const realDb = await openDatabase(queue.replaceAll("/", "-") + ".sqlite");
      await migrateOld109(realDb);
      await realDb.prepare(
        `UPDATE "${MIGRATION_LOCK_TABLE}" SET holder = 'other-isolate', lease_expires_at = ?, status = 'applying', updated_at = ? WHERE id = 1`,
      ).bind(new Date(Date.now() + 60_000).toISOString(), new Date().toISOString()).run();
      const tracked = trackDb(realDb);
      const env = workerEnv(tracked.db);
      const runtime = createWorkerRuntime(() => platformFor(env));
      const { batch, calls } = queueBatch(queue, undefined, 2);

      await runtime.queue(batch, env);

      expect(calls).toEqual([
        { action: "retry", delaySeconds: 5 },
        { action: "retry", delaySeconds: 5 },
      ]);
      expect(tracked.domainSql).toEqual([]);
      const status = await realDb.prepare(
        `SELECT status FROM "${MIGRATION_LOCK_TABLE}" WHERE id = 1`,
      ).first<{ status: string }>();
      expect(status?.status).toBe("applying");
    },
  );

  test("a broken 0110 batch blocks a DLQ until repair, then the same delivery commits once", async () => {
    const realDb = await openDatabase();
    await migrateOld109(realDb);
    await seedQueuedRun(realDb);
    const broken = trackDb(realDb, { failUsageOutboxMigration: true });
    const env = workerEnv(broken.db);
    const runtime = createWorkerRuntime(() => platformFor(env));
    const first = queueBatch("takos-runs-dlq");

    await runtime.queue(first.batch, env);

    expect(first.calls).toEqual([{ action: "retry", delaySeconds: 60 }]);
    expect(broken.domainSql).toEqual([]);
    const failedLedger = await realDb.prepare(
      `SELECT name FROM "${MIGRATION_LEDGER_TABLE}" WHERE name = ?`,
    ).bind("0110_run_usage_projection_outbox.sql").first();
    expect(failedLedger).toBeNull();

    await realDb.prepare(
      `UPDATE "${MIGRATION_LOCK_TABLE}" SET updated_at = '1970-01-01T00:00:00.000Z' WHERE id = 1`,
    ).run();

    // A new request binding retries the failed schema after cooldown has passed.
    const repaired = trackDb(realDb);
    const repairedEnv = workerEnv(repaired.db);
    const repairedRuntime = createWorkerRuntime(() => platformFor(repairedEnv));
    const replay = queueBatch("takos-runs-dlq");
    await repairedRuntime.queue(replay.batch, repairedEnv);
    expect(replay.calls).toEqual([{ action: "ack" }]);
    expect(repaired.domainSql.length).toBeGreaterThan(0);
    const applied = await realDb.prepare(
      `SELECT name FROM "${MIGRATION_LEDGER_TABLE}" WHERE name = ?`,
    ).bind("0110_run_usage_projection_outbox.sql").first<{ name: string }>();
    expect(applied?.name).toBe("0110_run_usage_projection_outbox.sql");
    const witnessTable = await realDb.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_usage_projection_outbox'`,
    ).first<{ name: string }>();
    expect(witnessTable?.name).toBe("run_usage_projection_outbox");

    const run = await realDb.prepare(
      `SELECT status, error, completion_key FROM runs WHERE id = 'run-1'`,
    ).first<{ status: string; error: string; completion_key: string }>();
    const events = await realDb.prepare(
      `SELECT type, event_key, data FROM run_events WHERE run_id = 'run-1' AND type = 'run.failed'`,
    ).all<{ type: string; event_key: string; data: string }>();
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("DLQ: Run failed permanently");
    expect(events.results).toHaveLength(1);
    expect(events.results[0]?.event_key).toBeTruthy();
    const terminalPayload = JSON.parse(events.results[0]!.data) as {
      permanent: boolean;
      status: string;
      run: { id: string; session_id: string | null };
    };
    expect(terminalPayload).toMatchObject({
      permanent: true,
      status: run?.status,
      run: { id: "run-1", session_id: null },
    });
    const witnesses = await realDb.prepare(
      `SELECT run_id, completion_key, run_status, workspace_id, owner_account_id, delivery_status
       FROM run_usage_projection_outbox WHERE run_id = 'run-1'`,
    ).all<{
      run_id: string;
      completion_key: string;
      run_status: string;
      workspace_id: string;
      owner_account_id: string;
      delivery_status: string;
    }>();
    expect(witnesses.results).toEqual([{
      run_id: "run-1",
      completion_key: run!.completion_key,
      run_status: "failed",
      workspace_id: "workspace-1",
      owner_account_id: "owner-1",
      delivery_status: "queued",
    }]);

    const exactReplay = queueBatch("takos-runs-dlq");
    await repairedRuntime.queue(exactReplay.batch, repairedEnv);
    expect(exactReplay.calls).toEqual([{ action: "ack" }]);
    const eventCount = await realDb.prepare(
      `SELECT COUNT(*) AS count FROM run_events WHERE run_id = 'run-1' AND type = 'run.failed'`,
    ).first<{ count: number }>();
    expect(eventCount?.count).toBe(1);
    const witnessCount = await realDb.prepare(
      `SELECT COUNT(*) AS count FROM run_usage_projection_outbox WHERE run_id = 'run-1'`,
    ).first<{ count: number }>();
    expect(witnessCount?.count).toBe(1);
    const lock = await realDb.prepare(
      `SELECT status FROM "${MIGRATION_LOCK_TABLE}" WHERE id = 1`,
    ).first<{ status: string }>();
    expect(lock?.status).toBe("ready");
  }, 5_000);

  test("failed migration cooldown uses a 60 second queue retry for all families", async () => {
    const db = await openDatabase();
    const invalid = [...OLD_109, {
      name: "0110_run_usage_projection_outbox.sql",
      sha256: EMBEDDED_MIGRATIONS.at(-1)!.sha256,
      sql: "NOT SQL;",
    }];
    const failure = await runPendingMigrations(db, { migrations: invalid });
    expect(failure.state).toBe("failed");

    for (const queue of QUEUE_FAMILIES) {
      resetSchemaGate(db);
      const tracked = trackDb(db);
      const env = workerEnv(tracked.db);
      const runtime = createWorkerRuntime(() => platformFor(env));
      const { batch, calls } = queueBatch(queue, undefined, 2);
      await runtime.queue(batch, env);
      expect(calls).toEqual([
        { action: "retry", delaySeconds: 60 },
        { action: "retry", delaySeconds: 60 },
      ]);
      expect(tracked.domainSql).toEqual([]);
    }
  }, 5_000);
});

describe("background schema admission and managed bindings", () => {
  test("worker scheduled entrypoint fails before runner and prewarm domain work", async () => {
    const realDb = await openDatabase();
    await migrateOld109(realDb);
    const tracked = trackDb(realDb, { failUsageOutboxMigration: true });
    const env = workerEnv(tracked.db);
    env.EXECUTOR_TIER1_PREWARM_ENABLED = "1";
    const runtime = createWorkerRuntime(() => platformFor(env));
    await expect(runtime.scheduled(
      { cron: "* * * * *", scheduledTime: Date.now(), waitUntil() {} },
      env,
    )).rejects.toThrow(/runtime schema/i);
    expect(tracked.domainSql).toEqual([]);
  }, 5_000);

  test("web scheduled admission rejects before maintenance SQL, including through createWebWorker", async () => {
    const realDb = await openDatabase();
    await migrateOld109(realDb);
    const tracked = trackDb(realDb, { failUsageOutboxMigration: true });
    const env = workerEnv(tracked.db) as WorkerEnv & Record<string, unknown>;
    env.HOSTNAME_ROUTING = { async get() { return null; } } as never;
    const platform = platformFor(env);
    const web = createWebWorker(() => platform);
    await expect(web.scheduled(
      { cron: "*/15 * * * *", scheduledTime: Date.now() } as never,
      env as never,
    )).rejects.toThrow(/runtime schema/i);
    expect(tracked.domainSql).toEqual([]);
  }, 5_000);

  test("node open-time and tagged edge.sql bindings bypass native DDL admission", async () => {
    const db = await openDatabase();
    await migrateOld109(db);
    const nodeEnv = workerEnv(db);
    const nodeRuntime = createWorkerRuntime(() => platformFor(nodeEnv, "node"));
    const invalidPush = { notificationId: "", userId: "" };
    const nodeMessage = queueBatch("takos-notification-push", invalidPush);
    await nodeRuntime.queue(nodeMessage.batch, nodeEnv);
    expect(nodeMessage.calls).toEqual([{ action: "ack" }]);

    const statements: string[] = [];
    const edgeDb = adaptEdgeSqlBinding({
      async execute(sql) {
        statements.push(sql);
        return { rows: [], rowsWritten: 0 };
      },
      async query(sql) {
        statements.push(sql);
        return { rows: [], rowsWritten: 0 };
      },
      async transaction(items) {
        statements.push(...items.map((item) => item.sql));
        return { results: items.map(() => ({ rows: [], rowsWritten: 0 })) };
      },
    });
    const edgeEnv = workerEnv(edgeDb);
    const edgeRuntime = createWorkerRuntime(() => platformFor(edgeEnv));
    const edgeMessage = queueBatch("takos-notification-push", invalidPush);
    await edgeRuntime.queue(edgeMessage.batch, edgeEnv);
    expect(edgeMessage.calls).toEqual([{ action: "ack" }]);
    expect(statements.some((sql) => /CREATE TABLE|run_usage_projection_outbox/iu.test(sql))).toBe(false);
    const applied = await db.prepare(
      `SELECT name FROM "${MIGRATION_LEDGER_TABLE}" WHERE name = ?`,
    ).bind("0110_run_usage_projection_outbox.sql").first();
    expect(applied).toBeNull();
  }, 5_000);
});
