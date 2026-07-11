import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import {
  checkIdempotency,
  cleanupStaleOperations,
  completeOperation,
  fencePendingOperationsForClaimedRun,
  markOperationUncertain,
  STALE_PENDING_THRESHOLD_MS,
} from "../idempotency.ts";
import { ToolExecutor } from "../executor.ts";
import type { ToolResolver } from "../resolver.ts";
import type {
  RegisteredTool,
  ToolContext,
  ToolDefinition,
} from "../tool-definitions.ts";

async function withOperationsDb(
  run: (
    db: ReturnType<typeof drizzle<typeof schema>>,
    client: ReturnType<typeof createClient>,
  ) => Promise<void>,
) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE tool_operations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result_output TEXT,
      result_error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE UNIQUE INDEX idx_tool_operations_key
      ON tool_operations(run_id, operation_key);
  `);
  try {
    await run(drizzle(client, { schema }), client);
  } finally {
    client.close();
  }
}

test("commit-ambiguous side effects are fenced from automatic replay", async () => {
  await withOperationsDb(async (db) => {
    const binding = db as unknown as SqlDatabaseBinding;
    const first = await checkIdempotency(binding, "run-1", "remote_write", {
      value: 1,
    });
    expect(first.action).toBe("execute");
    await markOperationUncertain(
      binding,
      first.operationId!,
      "remote outcome unknown",
    );

    const retry = await checkIdempotency(binding, "run-1", "remote_write", {
      value: 1,
    });
    expect(retry.action).toBe("cached");
    expect(retry.cachedError).toContain("remote outcome unknown");
  });
});

test("cleanup retains uncertain operations until their Run is terminal", async () => {
  await withOperationsDb(async (db, client) => {
    await client.executeMultiple(`
      INSERT INTO runs (id, status) VALUES
        ('run-active', 'running'), ('run-terminal', 'completed');
      INSERT INTO tool_operations
        (id, run_id, operation_key, tool_name, status, result_error, created_at)
      VALUES
        ('op-active', 'run-active', 'key-active', 'write', 'uncertain', 'unknown', '1970-01-01T00:00:00.000Z'),
        ('op-terminal', 'run-terminal', 'key-terminal', 'write', 'uncertain', 'unknown', '1970-01-01T00:00:00.000Z');
    `);
    const removed = await cleanupStaleOperations(
      db as unknown as SqlDatabaseBinding,
      { now: () => 2 * 24 * 60 * 60 * 1000 },
    );
    expect(removed).toBe(1);
    const rows = await client.execute(
      "SELECT id FROM tool_operations ORDER BY id",
    );
    expect(rows.rows.map((row) => row.id)).toEqual(["op-active"]);
  });
});

test("an abandoned pending side effect becomes uncertain instead of replaying", async () => {
  await withOperationsDb(async (db, client) => {
    const binding = db as unknown as SqlDatabaseBinding;
    const first = await checkIdempotency(binding, "run-2", "remote_write", {
      value: 2,
    });
    expect(first.action).toBe("execute");
    await client.execute({
      sql: "UPDATE tool_operations SET created_at = ? WHERE id = ?",
      args: ["1970-01-01T00:00:00.000Z", first.operationId!],
    });

    const now = STALE_PENDING_THRESHOLD_MS + 1;
    const retry = await checkIdempotency(
      binding,
      "run-2",
      "remote_write",
      { value: 2 },
      { now: () => now },
    );
    expect(retry.action).toBe("cached");
    expect(retry.cachedError).toContain("Automatic replay is blocked");
    const row = await client.execute({
      sql: "SELECT status FROM tool_operations WHERE id = ?",
      args: [first.operationId!],
    });
    expect(row.rows[0].status).toBe("uncertain");
  });
});

test("a replacement lease fences pending side effects before dispatch", async () => {
  await withOperationsDb(async (db, client) => {
    const binding = db as unknown as SqlDatabaseBinding;
    const first = await checkIdempotency(binding, "run-recovered", "publish", {
      target: "production",
    });
    expect(first.action).toBe("execute");

    const fenced = await fencePendingOperationsForClaimedRun(
      binding,
      "run-recovered",
      { now: () => 1234 },
    );
    expect(fenced).toBe(1);
    // A late old-executor callback cannot rewrite the conservative fence.
    await completeOperation(binding, first.operationId!, "late success");

    const row = await client.execute({
      sql: "SELECT status, result_error FROM tool_operations WHERE id = ?",
      args: [first.operationId!],
    });
    expect(row.rows[0].status).toBe("uncertain");
    expect(String(row.rows[0].result_error)).toContain("lost its Run lease");

    const retry = await checkIdempotency(binding, "run-recovered", "publish", {
      target: "production",
    });
    expect(retry.action).toBe("cached");
    expect(retry.outcomeUncertain).toBe(true);
  });
});

test("a side-effect timeout records an uncertain outcome", async () => {
  await withOperationsDb(async (db, client) => {
    const definition: ToolDefinition = {
      name: "slow_remote_write",
      description: "A remote side effect",
      category: "mcp",
      risk_level: "high",
      side_effects: true,
      parameters: { type: "object", properties: {} },
    };
    const registered: RegisteredTool = {
      definition,
      custom: false,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return "late success";
      },
    };
    const resolver = {
      resolve: (name: string) =>
        name === definition.name ? registered : undefined,
    } as unknown as ToolResolver;
    const context = {
      spaceId: "space-1",
      threadId: "thread-1",
      runId: "run-timeout",
      userId: "user-1",
      role: "editor",
      capabilities: [],
      env: {},
      db,
    } as unknown as ToolContext;
    const executor = new ToolExecutor(resolver, context, undefined, 1);
    executor.setSideEffectTools([definition.name]);

    const result = await executor.execute({
      id: "call-timeout",
      name: definition.name,
      arguments: {},
    });
    expect(result.error).toContain("timed out");
    expect(result.outcome_uncertain).toBe(true);
    const row = await client.execute(
      "SELECT status FROM tool_operations WHERE run_id = 'run-timeout'",
    );
    expect(row.rows[0].status).toBe("uncertain");
  });
});
