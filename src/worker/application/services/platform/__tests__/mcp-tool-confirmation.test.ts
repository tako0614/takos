import { expect, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Database } from "../../../../infra/db/client.ts";
import type { Env } from "../../../../shared/types/index.ts";
import type { RunExecutionAuthority } from "../../runs/run-authority.ts";
import {
  decideMcpToolConfirmation,
  listActionableMcpToolConfirmations,
  requireMcpToolInvocationConfirmation,
} from "../mcp/tool-confirmation.ts";

async function freshDb(): Promise<{ client: Client; db: Database }> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (id TEXT PRIMARY KEY);
    CREATE TABLE threads (id TEXT PRIMARY KEY, account_id TEXT NOT NULL);
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      requester_account_id TEXT
    );
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE mcp_tool_confirmations (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      server_name TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      schema_hash TEXT NOT NULL,
      arguments_hash TEXT NOT NULL,
      arguments_ciphertext TEXT NOT NULL,
      requested_run_id TEXT NOT NULL,
      requested_thread_id TEXT NOT NULL,
      consumed_run_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      decided_at TEXT,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_mcp_tool_confirmations_account_user_status_expiry
      ON mcp_tool_confirmations(account_id, user_id, status, expires_at);
    CREATE TABLE mcp_tool_confirmation_identities (
      confirmation_id TEXT PRIMARY KEY,
      identity_version INTEGER NOT NULL,
      principal_id TEXT NOT NULL,
      requested_run_id TEXT NOT NULL,
      requested_thread_id TEXT NOT NULL,
      run_context_revision INTEGER NOT NULL,
      run_context_digest TEXT NOT NULL,
      run_grant_digest TEXT NOT NULL,
      identity_extension_version INTEGER,
      active_context_revision INTEGER,
      active_context_digest TEXT,
      requested_tool_call_id TEXT NOT NULL,
      identity_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (confirmation_id) REFERENCES mcp_tool_confirmations(id)
        ON DELETE CASCADE,
      FOREIGN KEY (principal_id) REFERENCES accounts(id),
      FOREIGN KEY (requested_run_id) REFERENCES runs(id),
      FOREIGN KEY (requested_thread_id) REFERENCES threads(id)
    );
    CREATE TABLE mcp_confirmation_run_grants (
      confirmation_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      principal_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      run_context_revision INTEGER NOT NULL,
      run_context_digest TEXT NOT NULL,
      run_grant_digest TEXT NOT NULL,
      origin_identity_hash TEXT NOT NULL,
      consumed_tool_call_id TEXT,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (confirmation_id) REFERENCES mcp_tool_confirmations(id)
        ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
    INSERT INTO accounts (id) VALUES ('space_a'), ('user_a'), ('user_b');
    INSERT INTO threads (id, account_id)
      VALUES ('thread_a', 'space_a'), ('thread_b', 'space_a');
    INSERT INTO runs (id, thread_id, account_id, requester_account_id) VALUES
      ('run_a', 'thread_a', 'space_a', 'user_a'),
      ('run_b', 'thread_a', 'space_a', 'user_a'),
      ('run_c', 'thread_b', 'space_a', 'user_a');
    INSERT INTO mcp_servers (id, account_id) VALUES ('server_a', 'space_a');
  `);
  return {
    client,
    db: drizzle(client, { schema }) as unknown as Database,
  };
}

function env(secret = "confirmation-test-secret"): Env {
  return { ENCRYPTION_KEY: secret } as Env;
}

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function authority(
  runId: string,
  threadId: string,
  confirmationGrantIds: string[] = [],
): RunExecutionAuthority {
  const attestation = {
    contextRevision: 1,
    contextDigest: digest(runId === "run_a" ? "a" : "b"),
    runGrantDigest: digest(runId === "run_a" ? "c" : "d"),
  };
  return {
    runId,
    principalId: "user_a",
    workspaceId: "space_a",
    threadId,
    capabilities: [],
    confirmationGrantIds,
    budgets: { maxGraphSteps: 8, maxToolRounds: 4 },
    baseAttestation: attestation,
    attestation,
  };
}

function request(
  overrides: Partial<{
    userId: string;
    runId: string;
    threadId: string;
    serverId: string;
    serverName: string;
    arguments: Record<string, unknown>;
    toolCallId: string;
    confirmationGrantIds: string[];
    runAuthority: RunExecutionAuthority;
  }> = {},
) {
  const runId = overrides.runId ?? "run_a";
  const threadId = overrides.threadId ?? "thread_a";
  return {
    accountId: "space_a",
    userId: overrides.userId ?? "user_a",
    serverId: overrides.serverId ?? "server_a",
    serverName: overrides.serverName ?? "External Docs",
    toolName: "docs.read",
    schemaHash: "a".repeat(64),
    arguments: overrides.arguments ?? { id: "doc_1", options: { mode: "raw" } },
    runId,
    threadId,
    runAuthority: overrides.runAuthority ?? authority(
      runId,
      threadId,
      overrides.confirmationGrantIds,
    ),
    toolCallId: overrides.toolCallId ?? "tool_call_a",
  };
}

test("confirmation accepts virtual Capsule publication server identities", async () => {
  const { client, db } = await freshDb();
  try {
    const result = await requireMcpToolInvocationConfirmation(
      db,
      env(),
      request({
        serverId: "publication:capsule_output_1",
        serverName: "Capsule Documents",
      }),
    );
    expect(result.kind).toBe("pending");
    const rows = await client.execute(
      "SELECT server_id, server_name FROM mcp_tool_confirmations",
    );
    expect(rows.rows).toEqual([{
      server_id: "publication:capsule_output_1",
      server_name: "Capsule Documents",
    }]);
  } finally {
    client.close();
  }
});

test("confirmation identity binds base handoff and active progressive context", async () => {
  const { client, db } = await freshDb();
  try {
    const base = authority("run_a", "thread_a");
    const progressive: RunExecutionAuthority = {
      ...base,
      attestation: {
        ...base.attestation,
        contextRevision: 2,
        contextDigest: digest("e"),
      },
    };
    const first = await requireMcpToolInvocationConfirmation(
      db,
      env(),
      request({ runAuthority: progressive }),
    );
    expect(first.kind).toBe("pending");
    const identity = await client.execute(
      `SELECT run_context_revision, run_context_digest,
              identity_extension_version, active_context_revision,
              active_context_digest
       FROM mcp_tool_confirmation_identities`,
    );
    expect(identity.rows[0]).toMatchObject({
      run_context_revision: 1,
      run_context_digest: base.baseAttestation.contextDigest,
      identity_extension_version: 1,
      active_context_revision: 2,
      active_context_digest: progressive.attestation.contextDigest,
    });
    const replay = await requireMcpToolInvocationConfirmation(
      db,
      env(),
      request({ runAuthority: progressive }),
    );
    expect(replay).toEqual(first);

    const differentActive: RunExecutionAuthority = {
      ...progressive,
      attestation: {
        ...progressive.attestation,
        contextDigest: digest("f"),
      },
    };
    const different = await requireMcpToolInvocationConfirmation(
      db,
      env(),
      request({ runAuthority: differentActive }),
    );
    expect(different.kind).toBe("pending");
    const count = await client.execute(
      "SELECT count(*) AS count FROM mcp_tool_confirmation_identities",
    );
    expect(Number(count.rows[0]?.count)).toBe(2);
  } finally {
    client.close();
  }
});

test("MCP confirmation reuses only its exact origin identity", async () => {
  const { client, db } = await freshDb();
  try {
    const first = await requireMcpToolInvocationConfirmation(
      db,
      env(),
      request(),
    );
    expect(first.kind).toBe("pending");
    const same = await requireMcpToolInvocationConfirmation(
      db,
      env(),
      request({ arguments: { options: { mode: "raw" }, id: "doc_1" } }),
    );
    expect(same).toEqual(first);
    const differentCall = await requireMcpToolInvocationConfirmation(
      db,
      env(),
      request({ toolCallId: "tool_call_b" }),
    );
    expect(differentCall.kind).toBe("pending");
    expect(differentCall.confirmationId).not.toBe(first.confirmationId);

    const listed = await listActionableMcpToolConfirmations(db, env(), {
      accountId: "space_a",
      userId: "user_a",
    });
    expect(listed).toHaveLength(2);
    expect(listed[0]?.arguments).toEqual({
      id: "doc_1",
      options: { mode: "raw" },
    });
    expect(
      await listActionableMcpToolConfirmations(db, env(), {
        accountId: "space_a",
        userId: "user_b",
      }),
    ).toEqual([]);

    const raw = await client.execute(
      "SELECT arguments_hash, arguments_ciphertext FROM mcp_tool_confirmations",
    );
    expect(String(raw.rows[0]?.arguments_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(String(raw.rows[0]?.arguments_ciphertext)).not.toContain("doc_1");
  } finally {
    client.close();
  }
});

test("approval requires an explicit same-Thread Run claim and consumes once", async () => {
  const { client, db } = await freshDb();
  try {
    const pending = await requireMcpToolInvocationConfirmation(
      db,
      env(),
      request(),
    );
    const decision = await decideMcpToolConfirmation(db, {
      accountId: "space_a",
      userId: "user_a",
      confirmationId: pending.confirmationId,
      decision: "approve",
    });
    expect(decision).toMatchObject({
      status: "approved",
      confirmationGrantId: pending.confirmationId,
      requestedThreadId: "thread_a",
    });
    await expect(decideMcpToolConfirmation(db, {
      accountId: "space_a",
      userId: "user_a",
      confirmationId: pending.confirmationId,
      decision: "approve",
    })).resolves.toEqual(decision);
    const recoverable = await listActionableMcpToolConfirmations(db, env(), {
      accountId: "space_a",
      userId: "user_a",
    });
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0]).toMatchObject({
      id: pending.confirmationId,
      status: "approved",
      requestedThreadId: "thread_a",
    });

    await expect(
      requireMcpToolInvocationConfirmation(db, env(), request()),
    ).resolves.toMatchObject({
      kind: "handoff",
      confirmationId: pending.confirmationId,
    });

    const identity = await client.execute({
      sql: `SELECT identity_hash FROM mcp_tool_confirmation_identities
            WHERE confirmation_id = ?`,
      args: [pending.confirmationId],
    });
    const nextAuthority = authority("run_b", "thread_a", [
      pending.confirmationId,
    ]);
    await client.execute({
      sql: `INSERT INTO mcp_confirmation_run_grants (
        confirmation_id, run_id, principal_id, workspace_id, thread_id,
        run_context_revision, run_context_digest, run_grant_digest,
        origin_identity_hash, consumed_tool_call_id, consumed_at, created_at
      ) VALUES (?, 'run_b', 'user_a', 'space_a', 'thread_a', 1, ?, ?, ?, NULL, NULL, ?)`,
      args: [
        pending.confirmationId,
        nextAuthority.attestation.contextDigest,
        nextAuthority.attestation.runGrantDigest,
        String(identity.rows[0]?.identity_hash),
        new Date().toISOString(),
      ],
    });
    expect(
      await listActionableMcpToolConfirmations(db, env(), {
        accountId: "space_a",
        userId: "user_a",
      }),
    ).toEqual([]);

    const toolCallIds = ["retry_call", "other_call"];
    const concurrent = await Promise.all(
      toolCallIds.map((toolCallId) =>
        requireMcpToolInvocationConfirmation(
          db,
          env(),
          request({
            runId: "run_b",
            threadId: "thread_a",
            toolCallId,
            confirmationGrantIds: [pending.confirmationId],
          }),
        )
      ),
    );
    expect(concurrent.map((result) => result.kind).sort()).toEqual([
      "approved",
      "pending",
    ]);
    const approvedIndex = concurrent.findIndex((result) =>
      result.kind === "approved"
    );
    const winningToolCallId = toolCallIds[approvedIndex]!;
    await expect(requireMcpToolInvocationConfirmation(
      db,
      env(),
      request({
        runId: "run_b",
        threadId: "thread_a",
        toolCallId: winningToolCallId,
        confirmationGrantIds: [pending.confirmationId],
      }),
    )).resolves.toEqual({
      kind: "approved",
      confirmationId: pending.confirmationId,
    });
    const consumed = await client.execute({
      sql: `SELECT c.status, c.consumed_run_id, g.consumed_tool_call_id
            FROM mcp_tool_confirmations c
            JOIN mcp_confirmation_run_grants g
              ON g.confirmation_id = c.id
            WHERE c.id = ?`,
      args: [pending.confirmationId],
    });
    expect(consumed.rows).toEqual([{
      status: "consumed",
      consumed_run_id: "run_b",
      consumed_tool_call_id: winningToolCallId,
    }]);
  } finally {
    client.close();
  }
});

test("concurrent confirmation decisions have one winner", async () => {
  const { client, db } = await freshDb();
  try {
    const pending = await requireMcpToolInvocationConfirmation(
      db,
      env(),
      request(),
    );
    const decisions = await Promise.allSettled([
      decideMcpToolConfirmation(db, {
        accountId: "space_a",
        userId: "user_a",
        confirmationId: pending.confirmationId,
        decision: "approve",
      }),
      decideMcpToolConfirmation(db, {
        accountId: "space_a",
        userId: "user_a",
        confirmationId: pending.confirmationId,
        decision: "deny",
      }),
    ]);
    expect(decisions.filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    expect(decisions.filter((result) => result.status === "rejected"))
      .toHaveLength(1);
  } finally {
    client.close();
  }
});

test("confirmation rejects missing authority and unbounded input", async () => {
  const { client, db } = await freshDb();
  try {
    await expect(
      requireMcpToolInvocationConfirmation(
        db,
        env(),
        { ...request(), toolCallId: undefined as never },
      ),
    ).rejects.toThrow("Invalid MCP confirmation tool call id");
    await expect(
      requireMcpToolInvocationConfirmation(
        db,
        env(),
        request({ serverName: "s".repeat(256) }),
      ),
    ).rejects.toThrow("Invalid MCP confirmation server name");

    let argumentsValue: Record<string, unknown> = {};
    for (let depth = 0; depth < 34; depth += 1) {
      argumentsValue = { child: argumentsValue };
    }
    await expect(
      requireMcpToolInvocationConfirmation(
        db,
        env(),
        request({ arguments: argumentsValue }),
      ),
    ).rejects.toThrow("MCP tool arguments exceed the confirmation shape limit");
    await expect(
      decideMcpToolConfirmation(db, {
        accountId: "space_a",
        userId: "user_a",
        confirmationId: "confirmation_a",
        decision: "later" as never,
      }),
    ).rejects.toThrow("Invalid MCP confirmation decision");

    const rows = await client.execute("SELECT id FROM mcp_tool_confirmations");
    expect(rows.rows).toEqual([]);
  } finally {
    client.close();
  }
});
