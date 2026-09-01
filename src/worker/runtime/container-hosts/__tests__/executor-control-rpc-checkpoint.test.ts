import { createClient } from "@libsql/client";
import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import type { SqlPreparedStatementBinding } from "../../../shared/types/bindings.ts";
import {
  RunExecutionAuthorityUnavailableError,
  type RunAuthorityAttestation,
} from "../../../application/services/runs/run-authority.ts";
import {
  beginRunModelCallAtomically,
} from "../../../application/services/runs/run-model-call-authority.ts";
import {
  createPreparedStatement,
  createSequentialBatch,
} from "../../../local-platform/d1-prepared-statement.ts";
import {
  handleEngineCheckpointLoad as handleEngineCheckpointLoadRaw,
  handleEngineCheckpointSave as handleEngineCheckpointSaveRaw,
  handleModelCallBegin,
  type EngineCheckpointAuthorityDependencies,
} from "../executor-control-rpc.ts";

const BASE_RUN_AUTHORITY: RunAuthorityAttestation = {
  contextRevision: 1,
  contextDigest:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  runGrantDigest:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

function executionAuthority(
  attestation: RunAuthorityAttestation = BASE_RUN_AUTHORITY,
) {
  return {
    runId: "run-1",
    principalId: "user-1",
    workspaceId: "space-1",
    threadId: "thread-1",
    capabilities: [],
    confirmationGrantIds: [],
    budgets: { maxGraphSteps: 64, maxToolRounds: 8 },
    baseAttestation: BASE_RUN_AUTHORITY,
    attestation,
  };
}

const checkpointAuthorityDependencies: EngineCheckpointAuthorityDependencies = {
  resolveAuthority: async () => executionAuthority(),
  verifyCheckpointAuthority: async ({
    checkpointAuthority,
    currentAuthority,
  }) => {
    if (
      checkpointAuthority.runGrantDigest !==
        currentAuthority.attestation.runGrantDigest ||
      checkpointAuthority.contextRevision >
        currentAuthority.attestation.contextRevision ||
      (checkpointAuthority.contextRevision === 1 &&
        checkpointAuthority.contextDigest !==
          BASE_RUN_AUTHORITY.contextDigest)
    ) {
      throw new Error("invalid checkpoint authority");
    }
  },
};

const handleEngineCheckpointSave = (
  body: Record<string, unknown>,
  env: never,
  dependencies = checkpointAuthorityDependencies,
) =>
  handleEngineCheckpointSaveRaw(
    { ...authorityProtocolBody(), ...body },
    env,
    dependencies,
  );

const handleEngineCheckpointLoad = (
  body: Record<string, unknown>,
  env: never,
  dependencies = checkpointAuthorityDependencies,
) =>
  handleEngineCheckpointLoadRaw(
    { ...authorityProtocolBody(), ...body },
    env,
    dependencies,
  );

function authorityProtocolBody() {
  return {
    checkpointProtocolVersion: 3,
    runAuthority: BASE_RUN_AUTHORITY,
  };
}

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
      thread_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      requester_account_id TEXT,
      status TEXT NOT NULL,
      service_id TEXT,
      lease_version INTEGER NOT NULL DEFAULT 0,
      completion_key TEXT,
      current_context_revision INTEGER,
      terminal_reason TEXT,
      error TEXT,
      output TEXT,
      usage TEXT NOT NULL DEFAULT '{}',
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
      created_at TEXT NOT NULL
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
      resource_digest TEXT NOT NULL, created_at TEXT NOT NULL
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
      resource_digest TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE run_context_revisions (
      run_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      run_grant_digest TEXT NOT NULL,
      digest TEXT NOT NULL,
      PRIMARY KEY (run_id, revision)
    );
    CREATE TABLE run_grants (
      run_id TEXT PRIMARY KEY,
      digest TEXT NOT NULL
    );
    CREATE TABLE run_model_calls (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      context_revision INTEGER NOT NULL,
      context_digest TEXT NOT NULL,
      run_grant_digest TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      transport_attempt INTEGER NOT NULL,
      begin_nonce_digest TEXT NOT NULL,
      service_id TEXT NOT NULL,
      lease_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (run_id, context_revision, request_digest, transport_attempt)
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
    CREATE TABLE index_jobs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      target_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      event_key TEXT UNIQUE,
      data TEXT NOT NULL,
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
  `);
  await client.execute({
    sql: `INSERT INTO runs (
            id, thread_id, account_id, requester_account_id, status,
            service_id, lease_version, current_context_revision, created_at
          ) VALUES (?, 'thread-1', 'space-1', 'user-1', 'running', ?, ?, 1, ?)`,
    args: ["run-1", "service-1", 7, "2026-08-10T00:00:00.000Z"],
  });
  await client.execute({
    sql: "INSERT INTO run_grants (run_id, digest) VALUES (?, ?)",
    args: ["run-1", BASE_RUN_AUTHORITY.runGrantDigest],
  });
  await client.execute({
    sql: `INSERT INTO run_context_revisions
            (run_id, revision, run_grant_digest, digest)
          VALUES (?, 1, ?, ?)`,
    args: [
      "run-1",
      BASE_RUN_AUTHORITY.runGrantDigest,
      BASE_RUN_AUTHORITY.contextDigest,
    ],
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
      checkpointAuthority: BASE_RUN_AUTHORITY,
      runAuthority: BASE_RUN_AUTHORITY,
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
      checkpointAuthority: BASE_RUN_AUTHORITY,
      runAuthority: BASE_RUN_AUTHORITY,
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
    assertEquals(bareLoaded.status, 409);
    const terminal = await client.execute(
      `SELECT status, terminal_reason, engine_checkpoint
       FROM runs WHERE id = 'run-1'`,
    );
    assertEquals(terminal.rows[0]?.status, "failed");
    assertEquals(terminal.rows[0]?.terminal_reason, "context_invalid");
    assertEquals(terminal.rows[0]?.engine_checkpoint, null);

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
        checkpointAuthority: BASE_RUN_AUTHORITY,
        runAuthority: BASE_RUN_AUTHORITY,
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
      checkpointAuthority: null,
      runAuthority: BASE_RUN_AUTHORITY,
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

test("checkpoint protocol v3 rejects missing, stale, and pointer-raced Run authority", async () => {
  const { client, env } = await createFixture();
  try {
    const base = {
      runId: "run-1",
      serviceId: "service-1",
      leaseVersion: 7,
      checkpointProtocolVersion: 3,
      checkpoint: checkpoint(),
      usage: usage(),
    };
    assertEquals(
      (
        await handleEngineCheckpointSaveRaw(
          base,
          env,
          checkpointAuthorityDependencies,
        )
      ).status,
      409,
    );
    assertEquals(
      (
        await handleEngineCheckpointSaveRaw(
          {
            ...base,
            runAuthority: {
              ...BASE_RUN_AUTHORITY,
              contextDigest:
                "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            },
          },
          env,
          checkpointAuthorityDependencies,
        )
      ).status,
      409,
    );

    await client.execute(
      "UPDATE runs SET current_context_revision = 2 WHERE id = 'run-1'",
    );
    assertEquals(
      (
        await handleEngineCheckpointSaveRaw(
          { ...base, runAuthority: BASE_RUN_AUTHORITY },
          env,
          checkpointAuthorityDependencies,
        )
      ).status,
      409,
    );
    const run = await client.execute(
      "SELECT status, terminal_reason FROM runs WHERE id = 'run-1'",
    );
    assertEquals(run.rows[0]?.status, "running");
    assertEquals(run.rows[0]?.terminal_reason, null);
  } finally {
    client.close();
  }
});

test("Worker-owned Run authority corruption terminalizes instead of retry-looping", async () => {
  const { client, env } = await createFixture();
  const corruptAuthority: EngineCheckpointAuthorityDependencies = {
    resolveAuthority: async () => {
      throw new RunExecutionAuthorityUnavailableError(
        "stored RunContext digest mismatch",
      );
    },
    verifyCheckpointAuthority: async () => undefined,
  };
  try {
    const response = await handleEngineCheckpointLoadRaw(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
        checkpointProtocolVersion: 3,
        runAuthority: BASE_RUN_AUTHORITY,
      },
      env,
      corruptAuthority,
    );
    assertEquals(response.status, 409);
    const run = await client.execute(
      `SELECT status, terminal_reason, error
       FROM runs WHERE id = 'run-1'`,
    );
    assertEquals(run.rows[0]?.status, "failed");
    assertEquals(run.rows[0]?.terminal_reason, "context_invalid");
    assertEquals(
      String(run.rows[0]?.error).includes(
        "execution context could not be verified",
      ),
      true,
    );
    const event = await client.execute(
      "SELECT data FROM run_events WHERE run_id = 'run-1'",
    );
    assertEquals(JSON.parse(String(event.rows[0]?.data)).evidence, {
      stage: "checkpoint_load",
      code: "authority_record_invalid",
      currentContextRevision: 1,
    });
  } finally {
    client.close();
  }
});

test("model-call begin is exact-authority, response-loss idempotent, and restart-safe", async () => {
  const { client, env } = await createFixture();
  const dependencies = {
    resolveAuthority: async () => executionAuthority(),
    begin: beginRunModelCallAtomically,
  };
  const base = {
    runId: "run-1",
    serviceId: "service-1",
    leaseVersion: 7,
    runAuthority: BASE_RUN_AUTHORITY,
    requestDigest:
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    transportAttempt: 1,
    beginNonce: "12345678-1234-4234-8234-123456789abc",
  };
  try {
    const stale = await handleModelCallBegin(
      {
        ...base,
        runAuthority: {
          ...BASE_RUN_AUTHORITY,
          contextDigest:
            "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        },
      },
      env,
      dependencies,
    );
    assertEquals(stale.status, 409);
    assertEquals(
      Number((await client.execute("SELECT count(*) AS count FROM run_model_calls")).rows[0]?.count),
      0,
    );

    const started = await handleModelCallBegin(base, env, dependencies);
    assertEquals(started.status, 200);
    const startedBody = await started.json() as Record<string, unknown>;
    assertEquals(String(startedBody.modelCallId).startsWith("rmc_"), true);
    assertEquals(startedBody.idempotent, false);

    const responseLossRetry = await handleModelCallBegin(
      base,
      env,
      dependencies,
    );
    assertEquals(responseLossRetry.status, 200);
    assertEquals(
      (await responseLossRetry.json() as Record<string, unknown>).idempotent,
      true,
    );

    const replacement = await handleModelCallBegin(
      {
        ...base,
        beginNonce: "87654321-4321-4321-8321-cba987654321",
      },
      env,
      dependencies,
    );
    assertEquals(replacement.status, 409);
    const recorded = await client.execute(
      `SELECT context_revision, context_digest, run_grant_digest,
              request_digest, transport_attempt, service_id, lease_version
       FROM run_model_calls`,
    );
    assertEquals(recorded.rows.length, 1);
    assertEquals(recorded.rows[0], {
      context_revision: 1,
      context_digest: BASE_RUN_AUTHORITY.contextDigest,
      run_grant_digest: BASE_RUN_AUTHORITY.runGrantDigest,
      request_digest: base.requestDigest,
      transport_attempt: 1,
      service_id: "service-1",
      lease_version: 7,
    });
  } finally {
    client.close();
  }
});

test("resume verifies the saved exact ancestor while returning current Run authority", async () => {
  const { client, env } = await createFixture();
  const currentAuthority: RunAuthorityAttestation = {
    contextRevision: 2,
    contextDigest:
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    runGrantDigest: BASE_RUN_AUTHORITY.runGrantDigest,
  };
  const progressiveDependencies: EngineCheckpointAuthorityDependencies = {
    resolveAuthority: async () => executionAuthority(currentAuthority),
    verifyCheckpointAuthority: async ({ checkpointAuthority }) => {
      if (
        checkpointAuthority.contextRevision !== 1 ||
        checkpointAuthority.contextDigest !== BASE_RUN_AUTHORITY.contextDigest
      ) {
        throw new RunExecutionAuthorityUnavailableError(
          "checkpoint is not the verified base ancestor",
        );
      }
    },
  };
  try {
    assertEquals(
      (
        await handleEngineCheckpointSave(
          {
            runId: "run-1",
            serviceId: "service-1",
            leaseVersion: 7,
            checkpoint: checkpoint(),
            usage: usage(),
          },
          env,
        )
      ).status,
      200,
    );
    await client.execute(
      "UPDATE runs SET current_context_revision = 2 WHERE id = 'run-1'",
    );

    const response = await handleEngineCheckpointLoadRaw(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
        checkpointProtocolVersion: 3,
        runAuthority: currentAuthority,
      },
      env,
      progressiveDependencies,
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      checkpoint: checkpoint(),
      usage: usage(),
      fatalError: null,
      checkpointAuthority: BASE_RUN_AUTHORITY,
      runAuthority: currentAuthority,
    });

    const storedRow = await client.execute(
      "SELECT engine_checkpoint FROM runs WHERE id = 'run-1'",
    );
    const tampered = JSON.parse(
      String(storedRow.rows[0]?.engine_checkpoint),
    ) as Record<string, unknown>;
    tampered.runAuthority = {
      ...BASE_RUN_AUTHORITY,
      contextDigest:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    };
    await client.execute({
      sql: "UPDATE runs SET engine_checkpoint = ? WHERE id = 'run-1'",
      args: [JSON.stringify(tampered)],
    });
    const rejected = await handleEngineCheckpointLoadRaw(
      {
        runId: "run-1",
        serviceId: "service-1",
        leaseVersion: 7,
        checkpointProtocolVersion: 3,
        runAuthority: currentAuthority,
      },
      env,
      progressiveDependencies,
    );
    assertEquals(rejected.status, 409);
    const terminal = await client.execute(
      `SELECT status, terminal_reason, engine_checkpoint
       FROM runs WHERE id = 'run-1'`,
    );
    assertEquals(terminal.rows[0]?.status, "failed");
    assertEquals(terminal.rows[0]?.terminal_reason, "context_invalid");
    assertEquals(terminal.rows[0]?.engine_checkpoint, null);
    const event = await client.execute(
      "SELECT type, data FROM run_events WHERE run_id = 'run-1'",
    );
    assertEquals(event.rows.length, 1);
    assertEquals(event.rows[0]?.type, "error");
    assertEquals(
      JSON.parse(String(event.rows[0]?.data)).evidence,
      {
        stage: "checkpoint_load",
        code: "checkpoint_authority_invalid",
        checkpointContextRevision: 1,
        currentContextRevision: 2,
      },
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
