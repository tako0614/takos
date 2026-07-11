import { createClient } from "@libsql/client";
import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import type { SqlPreparedStatementBinding } from "../../../shared/types/bindings.ts";
import {
  createPreparedStatement,
  createSequentialBatch,
} from "../../../local-platform/d1-prepared-statement.ts";
import {
  handleEngineCheckpointLoad,
  handleEngineCheckpointSave,
} from "../executor-control-rpc.ts";

function checkpoint(currentNode = "execute_tools") {
  return {
    session_id: "session-1",
    loop_id: "loop-1",
    current_node: currentNode,
    status: "running",
    state_json: {
      session_id: "session-1",
      loop_id: "loop-1",
      execution_profile: "external_context",
      turn_messages: [],
      pending_tool_calls: [],
    },
  };
}

function usage() {
  return {
    inputTokens: 120,
    outputTokens: 30,
    cachedInputTokens: 20,
  };
}

function createOffloadBucket() {
  const values = new Map<string, string>();
  const bucket = {
    async get(key: string) {
      const value = values.get(key);
      if (value === undefined) return null;
      const bytes = new TextEncoder().encode(value);
      return {
        key,
        size: bytes.byteLength,
        etag: "test-etag",
        httpEtag: '"test-etag"',
        uploaded: new Date(0),
        body: new Response(value).body,
        bodyUsed: false,
        arrayBuffer: async () => bytes.buffer,
        text: async () => value,
        json: async () => JSON.parse(value),
        blob: async () => new Blob([value]),
      };
    },
    async head() {
      return null;
    },
    async put(key: string, value: string) {
      values.set(key, value);
      return null;
    },
    async delete(key: string | string[]) {
      for (const item of Array.isArray(key) ? key : [key]) {
        values.delete(item);
      }
    },
    async list() {
      return {
        objects: [],
        truncated: false,
        delimitedPrefixes: [],
      };
    },
  };
  return { bucket, values };
}

async function createFixture(options: { offload?: boolean } = {}) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      service_id TEXT,
      lease_version INTEGER NOT NULL DEFAULT 0,
      engine_checkpoint TEXT,
      engine_checkpoint_updated_at TEXT
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
  `);
  await client.execute({
    sql: "INSERT INTO runs (id, status, service_id, lease_version) VALUES (?, 'running', ?, ?)",
    args: ["run-1", "service-1", 7],
  });
  const runStatement = (statement: SqlPreparedStatementBinding) =>
    statement.run<Record<string, unknown>>();
  const db = {
    prepare(queryText: string) {
      return createPreparedStatement(client, queryText);
    },
    batch: createSequentialBatch(runStatement),
  };
  const offload = createOffloadBucket();
  return {
    client,
    env: {
      DB: db,
      ...(options.offload ? { TAKOS_OFFLOAD: offload.bucket } : {}),
    } as never,
    offload,
  };
}

test("engine checkpoint is saved and loaded under the current run lease", async () => {
  const { client, env } = await createFixture();
  try {
    const body = {
      runId: "run-1",
      serviceId: "service-1",
      leaseVersion: 7,
      checkpoint: checkpoint(),
      usage: usage(),
    };
    const saved = await handleEngineCheckpointSave(body, env);
    assertEquals(saved.status, 200);

    const loaded = await handleEngineCheckpointLoad(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
      },
      env,
    );
    assertEquals(loaded.status, 200);
    assertEquals(await loaded.json(), {
      checkpoint: checkpoint(),
      usage: usage(),
      fatalError: null,
    });

    const row = await client.execute({
      sql: "SELECT engine_checkpoint_updated_at FROM runs WHERE id = ?",
      args: ["run-1"],
    });
    assertEquals(typeof row.rows[0]?.engine_checkpoint_updated_at, "string");
  } finally {
    client.close();
  }
});

test("stale engine checkpoint writes are rejected without replacing state", async () => {
  const { client, env } = await createFixture();
  try {
    const current = {
      runId: "run-1",
      serviceId: "service-1",
      leaseVersion: 7,
      checkpoint: checkpoint(),
      usage: usage(),
    };
    assertEquals((await handleEngineCheckpointSave(current, env)).status, 200);

    const stale = await handleEngineCheckpointSave(
      {
        ...current,
        leaseVersion: 6,
        checkpoint: checkpoint("finalize_external_response"),
      },
      env,
    );
    assertEquals(stale.status, 409);

    const row = await client.execute({
      sql: "SELECT engine_checkpoint FROM runs WHERE id = ?",
      args: ["run-1"],
    });
    const stored = JSON.parse(String(row.rows[0]?.engine_checkpoint)) as {
      checkpoint: ReturnType<typeof checkpoint>;
      usage: ReturnType<typeof usage>;
    };
    assertEquals(stored.checkpoint.current_node, "execute_tools");
    assertEquals(stored.usage, usage());
  } finally {
    client.close();
  }
});

test("a replacement lease can resume the prior container checkpoint", async () => {
  const { client, env } = await createFixture();
  try {
    const saved = checkpoint();
    assertEquals(
      (
        await handleEngineCheckpointSave(
          {
            runId: "run-1",
            serviceId: "service-1",
            leaseVersion: 7,
            checkpoint: saved,
            usage: usage(),
          },
          env,
        )
      ).status,
      200,
    );
    await client.execute({
      sql: "UPDATE runs SET service_id = ?, lease_version = ? WHERE id = ?",
      args: ["service-2", 8, "run-1"],
    });

    const replacement = await handleEngineCheckpointLoad(
      {
        runId: "run-1",
        serviceId: "service-2",
        leaseVersion: 8,
      },
      env,
    );
    assertEquals(replacement.status, 200);
    assertEquals(await replacement.json(), {
      checkpoint: saved,
      usage: usage(),
      fatalError: null,
    });

    const superseded = await handleEngineCheckpointLoad(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
      },
      env,
    );
    assertEquals(superseded.status, 409);
  } finally {
    client.close();
  }
});

test("checkpoint v1 rejects unmetered or unenveloped checkpoint state", async () => {
  const { client, env } = await createFixture();
  try {
    await client.execute({
      sql: "UPDATE runs SET engine_checkpoint = ? WHERE id = ?",
      args: [JSON.stringify(checkpoint()), "run-1"],
    });
    const bareLoaded = await handleEngineCheckpointLoad(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
      },
      env,
    );
    assertEquals(bareLoaded.status, 500);

    const saved = await handleEngineCheckpointSave(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
        checkpoint: checkpoint("finalize_external_response"),
      },
      env,
    );
    assertEquals(saved.status, 400);
  } finally {
    client.close();
  }
});

test("Takos checkpoint endpoint rejects a second memory authority", async () => {
  const { client, env } = await createFixture();
  try {
    const invalid = checkpoint();
    invalid.state_json.execution_profile = "memory_aware";
    const response = await handleEngineCheckpointSave(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
        checkpoint: invalid,
        usage: usage(),
      },
      env,
    );
    assertEquals(response.status, 400);
  } finally {
    client.close();
  }
});

test("engine checkpoint rejects an invalid provider usage snapshot", async () => {
  const { client, env } = await createFixture();
  try {
    const response = await handleEngineCheckpointSave(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
        checkpoint: checkpoint(),
        usage: {
          inputTokens: 5,
          outputTokens: 1,
          cachedInputTokens: 6,
        },
      },
      env,
    );
    assertEquals(response.status, 400);
  } finally {
    client.close();
  }
});

test("uncertain side-effect recovery uses the operation ledger without replacing the checkpoint", async () => {
  const { client, env } = await createFixture();
  try {
    const fatalError =
      "side-effect outcome is uncertain; verify remote state before issuing a new operation; automatic replay is blocked";
    const saved = await handleEngineCheckpointSave(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
        checkpoint: checkpoint("execute_tools"),
        usage: usage(),
      },
      env,
    );
    assertEquals(saved.status, 200);
    assertEquals(
      await (
        await handleEngineCheckpointLoad(
          {
            runId: "run-1",
            serviceId: "service-1",
            leaseVersion: 7,
          },
          env,
        )
      ).json(),
      {
        checkpoint: checkpoint("execute_tools"),
        usage: usage(),
        fatalError: null,
      },
    );

    await client.execute({
      sql: `INSERT INTO tool_operations
        (id, run_id, operation_key, tool_name, status, created_at)
        VALUES (?, ?, ?, ?, 'uncertain', ?)`,
      args: ["op-1", "run-1", "key-1", "publish", new Date().toISOString()],
    });
    await client.execute({
      sql: "UPDATE runs SET engine_checkpoint = NULL WHERE id = ?",
      args: ["run-1"],
    });
    const operationAuthority = await handleEngineCheckpointLoad(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
        checkpointProtocolVersion: 2,
      },
      env,
    );
    assertEquals(operationAuthority.status, 200);
    assertEquals(await operationAuthority.json(), {
      checkpoint: null,
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      fatalError,
    });

    const releasedV1Wrapper = await handleEngineCheckpointLoad(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
        checkpointProtocolVersion: 1,
      },
      env,
    );
    assertEquals(releasedV1Wrapper.status, 409);
    assertEquals(
      ((await releasedV1Wrapper.json()) as { error?: string }).error,
      fatalError,
    );
  } finally {
    client.close();
  }
});

test("large engine checkpoints are offloaded and transparently loaded", async () => {
  const { client, env, offload } = await createFixture({ offload: true });
  try {
    const large = checkpoint();
    (large.state_json as Record<string, unknown>).padding = "x".repeat(
      512 * 1024 + 1,
    );
    const body = {
      runId: "run-1",
      serviceId: "service-1",
      leaseVersion: 7,
      checkpoint: large,
      usage: usage(),
    };
    assertEquals((await handleEngineCheckpointSave(body, env)).status, 200);

    const firstRow = await client.execute({
      sql: "SELECT engine_checkpoint FROM runs WHERE id = ?",
      args: ["run-1"],
    });
    const firstStored = String(firstRow.rows[0]?.engine_checkpoint);
    assertEquals(
      firstStored.startsWith("r2:agent-checkpoints/run-1/service-1/7/"),
      true,
    );
    assertEquals(offload.values.size, 1);

    const replacement = checkpoint("finalize_external_response");
    (replacement.state_json as Record<string, unknown>).padding = "y".repeat(
      512 * 1024 + 1,
    );
    assertEquals(
      (
        await handleEngineCheckpointSave(
          { ...body, checkpoint: replacement },
          env,
        )
      ).status,
      200,
    );
    const replacementRow = await client.execute({
      sql: "SELECT engine_checkpoint FROM runs WHERE id = ?",
      args: ["run-1"],
    });
    const replacementStored = String(replacementRow.rows[0]?.engine_checkpoint);
    assertEquals(replacementStored === firstStored, false);
    assertEquals(offload.values.has(firstStored.slice("r2:".length)), false);
    assertEquals(offload.values.size, 1);

    const loaded = await handleEngineCheckpointLoad(body, env);
    assertEquals(loaded.status, 200);
    const payload = (await loaded.json()) as {
      checkpoint: typeof replacement;
      usage: ReturnType<typeof usage>;
    };
    assertEquals(payload.checkpoint.current_node, "finalize_external_response");
    assertEquals(payload.usage, usage());
    assertEquals(
      (payload.checkpoint.state_json as Record<string, unknown>).padding,
      (replacement.state_json as Record<string, unknown>).padding,
    );
  } finally {
    client.close();
  }
});

test("engine checkpoints with mismatched identity or excessive depth are rejected", async () => {
  const { client, env } = await createFixture();
  try {
    const mismatched = checkpoint();
    mismatched.state_json.loop_id = "other-loop";
    assertEquals(
      (
        await handleEngineCheckpointSave(
          {
            runId: "run-1",
            serviceId: "service-1",
            leaseVersion: 7,
            checkpoint: mismatched,
            usage: usage(),
          },
          env,
        )
      ).status,
      400,
    );

    const tooDeep = checkpoint();
    let nested: Record<string, unknown> = {};
    (tooDeep.state_json as Record<string, unknown>).nested = nested;
    for (let depth = 0; depth < 70; depth++) {
      const next: Record<string, unknown> = {};
      nested.next = next;
      nested = next;
    }
    assertEquals(
      (
        await handleEngineCheckpointSave(
          {
            runId: "run-1",
            serviceId: "service-1",
            leaseVersion: 7,
            checkpoint: tooDeep,
            usage: usage(),
          },
          env,
        )
      ).status,
      400,
    );
  } finally {
    client.close();
  }
});
