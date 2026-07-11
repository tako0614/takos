import { expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Database } from "../../../../infra/db/client.ts";
import type { Env } from "../../../../shared/types/index.ts";
import {
  decideMcpToolConfirmation,
  listPendingMcpToolConfirmations,
  requireMcpToolInvocationConfirmation,
} from "../mcp/tool-confirmation.ts";

async function freshDb(): Promise<{ client: Client; db: Database }> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (id TEXT PRIMARY KEY);
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
    CREATE INDEX idx_mcp_tool_confirmations_invocation_match
      ON mcp_tool_confirmations(
        account_id, user_id, server_id, tool_name, schema_hash, arguments_hash
      );
    INSERT INTO accounts (id) VALUES ('space_a'), ('user_a'), ('user_b');
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

function request(
  overrides: Partial<{
    userId: string;
    runId: string;
    threadId: string;
    serverId: string;
    serverName: string;
    arguments: Record<string, unknown>;
  }> = {},
) {
  return {
    accountId: "space_a",
    userId: overrides.userId ?? "user_a",
    serverId: overrides.serverId ?? "server_a",
    serverName: overrides.serverName ?? "External Docs",
    toolName: "docs.read",
    schemaHash: "a".repeat(64),
    arguments: overrides.arguments ?? { id: "doc_1", options: { mode: "raw" } },
    runId: overrides.runId ?? "run_a",
    threadId: overrides.threadId ?? "thread_a",
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
    expect(rows.rows).toEqual([
      {
        server_id: "publication:capsule_output_1",
        server_name: "Capsule Documents",
      },
    ]);
  } finally {
    client.close();
  }
});

test("MCP confirmation reuses canonical arguments and decrypts only for its user", async () => {
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

    const listed = await listPendingMcpToolConfirmations(db, env(), {
      accountId: "space_a",
      userId: "user_a",
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.arguments).toEqual({
      id: "doc_1",
      options: { mode: "raw" },
    });
    expect(
      await listPendingMcpToolConfirmations(db, env(), {
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

test("one-time approval can be consumed by the next exact retry across runs", async () => {
  const { client, db } = await freshDb();
  try {
    const pending = await requireMcpToolInvocationConfirmation(
      db,
      env(),
      request(),
    );
    expect(pending.kind).toBe("pending");
    await expect(
      decideMcpToolConfirmation(db, {
        accountId: "space_a",
        userId: "user_a",
        confirmationId: pending.confirmationId,
        decision: "approve",
      }),
    ).resolves.toBe("approved");

    await expect(
      requireMcpToolInvocationConfirmation(
        db,
        env(),
        request({ runId: "run_b", threadId: "thread_b" }),
      ),
    ).resolves.toEqual({
      kind: "approved",
      confirmationId: pending.confirmationId,
    });

    const nextInvocation = await requireMcpToolInvocationConfirmation(
      db,
      env(),
      request({ runId: "run_b", threadId: "thread_b" }),
    );
    expect(nextInvocation.kind).toBe("pending");
    expect(nextInvocation.confirmationId).not.toBe(pending.confirmationId);
    const rows = await client.execute(
      "SELECT requested_run_id, status, consumed_run_id FROM mcp_tool_confirmations ORDER BY requested_run_id",
    );
    expect(rows.rows).toMatchObject([
      {
        requested_run_id: "run_a",
        status: "consumed",
        consumed_run_id: "run_b",
      },
      {
        requested_run_id: "run_b",
        status: "pending",
        consumed_run_id: null,
      },
    ]);
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
    expect(
      decisions.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      decisions.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  } finally {
    client.close();
  }
});
