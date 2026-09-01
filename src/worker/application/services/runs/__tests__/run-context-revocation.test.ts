import { expect, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";

import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
} from "../../../../shared/types/bindings.ts";
import { ensureRunLease } from "../../../../runtime/container-hosts/executor-control-rpc.ts";
import { runAgentResourceDeletionOutboxBatch } from "../../agent/resource-deletion.ts";
import { failRunForInvalidContext } from "../run-context-revocation.ts";

type TestStatement = SqlPreparedStatementBinding & {
  queryText: string;
  args: unknown[];
};

function resultSet<T>(result: {
  rows: unknown[];
  rowsAffected: number;
  lastInsertRowid?: bigint | undefined;
}): SqlResultBinding<T> {
  return {
    results: result.rows as T[],
    success: true,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: result.rows.length,
      rows_written: result.rowsAffected,
      last_row_id: Number(result.lastInsertRowid ?? 0),
      changed_db: result.rowsAffected > 0,
      changes: result.rowsAffected,
    },
  };
}

function bindingFor(client: Client): SqlDatabaseBinding {
  const prepare = (
    queryText: string,
    args: unknown[] = [],
  ): TestStatement => ({
    queryText,
    args,
    bind(...values: unknown[]) {
      return prepare(queryText, values);
    },
    async first<T>(column?: string): Promise<T | null> {
      const result = await client.execute({ sql: queryText, args });
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return (column ? row[column] : row) as T;
    },
    async run<T>() {
      return resultSet<T>(await client.execute({ sql: queryText, args }));
    },
    async all<T>() {
      return resultSet<T>(await client.execute({ sql: queryText, args }));
    },
    async raw<T>(options?: { columnNames?: boolean }) {
      const result = await client.execute({ sql: queryText, args });
      const values = result.rows.map((row) => Object.values(row));
      return (options?.columnNames
        ? [result.columns, ...values]
        : values) as T[];
    },
  } as TestStatement);
  return {
    prepare,
    async batch<T>(statements: SqlPreparedStatementBinding[]) {
      const results = await client.batch(
        statements.map((statement) => {
          const captured = statement as TestStatement;
          return { sql: captured.queryText, args: captured.args };
        }),
      );
      return results.map((result) => resultSet<T>(result));
    },
    async exec(query: string) {
      const startedAt = performance.now();
      await client.executeMultiple(query);
      return { count: 0, duration: performance.now() - startedAt };
    },
    withSession() {
      throw new Error("not used");
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as SqlDatabaseBinding;
}

test("tombstoned current context cancels the Run at the live lease fence", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        requester_account_id TEXT,
        service_id TEXT,
        lease_version INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        completion_key TEXT,
        current_context_revision INTEGER,
        terminal_reason TEXT,
        error TEXT,
        engine_checkpoint TEXT,
        engine_checkpoint_updated_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE run_context_resource_refs (
        run_id TEXT NOT NULL,
        context_revision INTEGER NOT NULL,
        workspace_id TEXT NOT NULL,
        resource_kind TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        resource_digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, context_revision, resource_kind, resource_id)
      );
      CREATE TABLE tool_descriptor_revisions (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, resource_id TEXT NOT NULL,
        logical_name TEXT NOT NULL, source TEXT NOT NULL,
        adapter_reference TEXT NOT NULL, adapter_revision TEXT NOT NULL,
        schema_digest TEXT NOT NULL, descriptor_digest TEXT NOT NULL,
        descriptor_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE run_context_tool_descriptor_refs (
        run_id TEXT NOT NULL, context_revision INTEGER NOT NULL,
        workspace_id TEXT NOT NULL, resource_id TEXT NOT NULL,
        resource_digest TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, context_revision, resource_id)
      );
      CREATE TABLE provider_materialization_revisions (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, run_id TEXT NOT NULL,
        resource_id TEXT NOT NULL, source_kind TEXT NOT NULL,
        protocol TEXT NOT NULL, endpoint TEXT,
        materialization_digest TEXT NOT NULL, materialization_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE run_context_provider_materialization_refs (
        run_id TEXT NOT NULL, context_revision INTEGER NOT NULL,
        workspace_id TEXT NOT NULL, resource_id TEXT NOT NULL,
        resource_digest TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, context_revision, resource_id)
      );
      CREATE TABLE agent_resource_tombstones (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        resource_kind TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        deleted_by_account_id TEXT,
        deleted_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE agent_resource_deletion_outbox (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        resource_kind TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        vector_ids TEXT NOT NULL DEFAULT '[]',
        offload_object_keys TEXT NOT NULL DEFAULT '[]',
        delivery_status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        claim_token TEXT,
        claimed_at TEXT,
        next_attempt_at TEXT,
        completed_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE index_jobs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        type TEXT NOT NULL,
        target_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE run_notification_outbox (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        completion_key TEXT NOT NULL UNIQUE,
        run_status TEXT NOT NULL,
        delivery_status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        claim_token TEXT,
        claimed_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        event_key TEXT UNIQUE,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO runs (
        id, thread_id, account_id, requester_account_id, service_id,
        lease_version, status, current_context_revision, engine_checkpoint,
        created_at
      ) VALUES (
        'run_revoked', 'thread_a', 'space_a', 'user_a', 'service_a',
        7, 'running', 2, 'r2:checkpoint/run_revoked',
        '2026-08-10T00:00:00.000Z'
      );
      INSERT INTO runs (
        id, thread_id, account_id, requester_account_id, service_id,
        lease_version, status, current_context_revision, created_at
      ) VALUES (
        'run_revoked_outbox', 'thread_b', 'space_a', 'user_a', 'service_b',
        3, 'running', 2, '2026-08-10T00:00:00.000Z'
      );
      INSERT INTO runs (
        id, thread_id, account_id, requester_account_id, service_id,
        lease_version, status, current_context_revision, engine_checkpoint,
        created_at
      ) VALUES (
        'run_invalid', 'thread_invalid', 'space_a', 'user_a', 'service_invalid',
        4, 'running', 2, 'r2:checkpoint/run_invalid',
        '2026-08-10T00:00:00.000Z'
      );
      INSERT INTO runs (
        id, thread_id, account_id, requester_account_id, service_id,
        lease_version, status, current_context_revision, created_at
      ) VALUES (
        'run_legacy', 'thread_legacy', 'space_a', 'user_a', 'service_legacy',
        1, 'running', NULL, '2026-08-10T00:00:00.000Z'
      );
      INSERT INTO run_context_resource_refs (
        run_id, context_revision, workspace_id, resource_kind, resource_id,
        resource_digest, created_at
      ) VALUES (
        'run_revoked', 2, 'space_a', 'explicit_memory', 'memory_a',
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-08-10T00:00:01.000Z'
      );
      INSERT INTO run_context_resource_refs (
        run_id, context_revision, workspace_id, resource_kind, resource_id,
        resource_digest, created_at
      ) VALUES (
        'run_revoked_outbox', 2, 'space_a', 'explicit_memory', 'memory_a',
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-08-10T00:00:01.000Z'
      );
      INSERT INTO agent_resource_tombstones (
        id, account_id, resource_kind, resource_id, source_digest,
        deleted_at, created_at
      ) VALUES (
        'tombstone_a', 'space_a', 'explicit_memory', 'memory_a',
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-08-10T00:00:02.000Z', '2026-08-10T00:00:02.000Z'
      );
      INSERT INTO agent_resource_deletion_outbox (
        id, account_id, resource_kind, resource_id, created_at, updated_at
      ) VALUES (
        'tombstone_a', 'space_a', 'explicit_memory', 'memory_a',
        '2026-08-10T00:00:02.000Z', '2026-08-10T00:00:02.000Z'
      );
    `);
    const deletedObjects: string[] = [];
    const response = await ensureRunLease(
      {
        DB: bindingFor(client),
        TAKOS_OFFLOAD: {
          delete: async (key: string | string[]) => {
            deletedObjects.push(...(Array.isArray(key) ? key : [key]));
          },
        } as never,
      },
      "run_revoked",
      { serviceId: "service_a", leaseVersion: 7 },
    );
    expect(response?.status).toBe(409);

    const run = await client.execute(
      `SELECT status, terminal_reason, error, engine_checkpoint, completed_at
       FROM runs WHERE id = 'run_revoked'`,
    );
    expect(run.rows[0]?.status).toBe("cancelled");
    expect(run.rows[0]?.terminal_reason).toBe("context_revoked");
    expect(String(run.rows[0]?.error)).toContain("referenced resource");
    expect(run.rows[0]?.engine_checkpoint).toBeNull();
    expect(run.rows[0]?.completed_at).not.toBeNull();
    expect(deletedObjects).toEqual(["checkpoint/run_revoked"]);

    const event = await client.execute(
      "SELECT type, data FROM run_events WHERE run_id = 'run_revoked'",
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0]?.type).toBe("cancelled");
    expect(JSON.parse(String(event.rows[0]?.data))).toMatchObject({
      reason: "context_revoked",
      evidence: {
        tombstoneId: "tombstone_a",
        resourceKind: "explicit_memory",
        resourceId: "memory_a",
      },
    });
    const jobs = await client.execute(
      "SELECT type FROM index_jobs ORDER BY type",
    );
    expect(jobs.rows.map((row) => row.type)).toEqual([
      "info_unit",
      "thread_context",
    ]);

    expect(await failRunForInvalidContext(
      bindingFor(client),
      "run_revoked_outbox",
      {
        stage: "checkpoint_load",
        code: "checkpoint_envelope_invalid",
      },
    )).toEqual({
      invalid: false,
      failed: false,
      legacy: false,
      revoked: true,
    });

    const outbox = await runAgentResourceDeletionOutboxBatch({
      DB: bindingFor(client),
      TAKOS_OFFLOAD: {
        delete: async () => undefined,
      } as never,
    }, { ids: ["tombstone_a"], limit: 1 });
    expect(outbox).toMatchObject({ claimed: 1, completed: 1, retrying: 0 });
    const converged = await client.execute(
      `SELECT status, terminal_reason FROM runs
       WHERE id = 'run_revoked_outbox'`,
    );
    expect(converged.rows[0]).toMatchObject({
      status: "cancelled",
      terminal_reason: "context_revoked",
    });

    const invalid = await failRunForInvalidContext(
      bindingFor(client),
      "run_invalid",
      {
        stage: "checkpoint_load",
        code: "checkpoint_authority_invalid",
        checkpointContextRevision: 1,
      },
      {
        delete: async (key: string | string[]) => {
          deletedObjects.push(...(Array.isArray(key) ? key : [key]));
        },
      } as never,
    );
    expect(invalid).toEqual({
      invalid: true,
      failed: true,
      legacy: false,
      revoked: false,
    });
    const invalidRun = await client.execute(
      `SELECT status, terminal_reason, error, engine_checkpoint
       FROM runs WHERE id = 'run_invalid'`,
    );
    expect(invalidRun.rows[0]).toMatchObject({
      status: "failed",
      terminal_reason: "context_invalid",
      engine_checkpoint: null,
    });
    expect(String(invalidRun.rows[0]?.error)).toContain(
      "execution context could not be verified",
    );
    expect(deletedObjects).toContain("checkpoint/run_invalid");
    const invalidEvent = await client.execute(
      "SELECT type, data FROM run_events WHERE run_id = 'run_invalid'",
    );
    expect(invalidEvent.rows).toHaveLength(1);
    expect(invalidEvent.rows[0]?.type).toBe("error");
    expect(JSON.parse(String(invalidEvent.rows[0]?.data))).toMatchObject({
      reason: "context_invalid",
      evidence: {
        stage: "checkpoint_load",
        code: "checkpoint_authority_invalid",
        checkpointContextRevision: 1,
        currentContextRevision: 2,
      },
    });
    const notification = await client.execute(
      `SELECT run_id, run_status, delivery_status
       FROM run_notification_outbox WHERE run_id = 'run_invalid'`,
    );
    expect(notification.rows[0]).toMatchObject({
      run_id: "run_invalid",
      run_status: "failed",
      delivery_status: "queued",
    });
    expect(await failRunForInvalidContext(
      bindingFor(client),
      "run_invalid",
      {
        stage: "tool_catalog",
        code: "authority_record_invalid",
      },
    )).toEqual({
      invalid: true,
      failed: false,
      legacy: false,
      revoked: false,
    });

    expect(await failRunForInvalidContext(
      bindingFor(client),
      "run_legacy",
      {
        stage: "tool_catalog",
        code: "authority_record_invalid",
      },
    )).toEqual({
      invalid: false,
      failed: false,
      legacy: true,
      revoked: false,
    });
    const legacy = await client.execute(
      "SELECT status, terminal_reason FROM runs WHERE id = 'run_legacy'",
    );
    expect(legacy.rows[0]).toMatchObject({
      status: "running",
      terminal_reason: null,
    });
  } finally {
    client.close();
  }
});
