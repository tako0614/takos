import { expect, test } from "bun:test";
import { createClient, type Client, type ResultSet } from "@libsql/client";

import type { Env } from "../../../../shared/types/index.ts";
import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
} from "../../../../shared/types/bindings.ts";
import { toWorkspaceResponse } from "../response-formatters.ts";
import { checkSpaceAccess } from "../space-access.ts";
import {
  getWorkspaceByIdOrSlug,
  listWorkspacesForUser,
} from "../space-crud-read.ts";

type RecordedStatement = SqlPreparedStatementBinding & {
  sql: string;
  args: unknown[];
};

function toSqlResult(result: ResultSet): SqlResultBinding {
  return {
    results: result.rows as unknown as Record<string, unknown>[],
    success: true,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: result.rowsAffected,
      last_row_id: Number(result.lastInsertRowid ?? 0),
      changed_db: result.rowsAffected > 0,
      changes: result.rowsAffected,
    },
  };
}

function d1Binding(client: Client): SqlDatabaseBinding {
  const prepare = (sql: string): RecordedStatement => {
    const statement = {
      sql,
      args: [] as unknown[],
      bind(...args: unknown[]) {
        statement.args = args;
        return statement;
      },
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        const result = await client.execute({ sql, args: statement.args as [] });
        return (result.rows[0] as T | undefined) ?? null;
      },
      async run<T = Record<string, unknown>>() {
        return toSqlResult(
          await client.execute({ sql, args: statement.args as [] }),
        ) as SqlResultBinding<T>;
      },
      async all<T = Record<string, unknown>>() {
        return toSqlResult(
          await client.execute({ sql, args: statement.args as [] }),
        ) as SqlResultBinding<T>;
      },
      async raw<T = unknown[]>() {
        const result = await client.execute({ sql, args: statement.args as [] });
        return result.rows.map((row) => Object.values(row)) as T[];
      },
    } as RecordedStatement;
    return statement;
  };

  return {
    prepare,
    async batch<T = Record<string, unknown>>(statements) {
      const recorded = statements as RecordedStatement[];
      const results = await client.batch(recorded.map((statement) => ({
        sql: statement.sql,
        args: statement.args as [],
      })));
      return results.map(toSqlResult) as SqlResultBinding<T>[];
    },
    async exec(query) {
      await client.executeMultiple(query);
      return { count: 0, duration: 0 };
    },
    withSession() {
      return {
        prepare,
        batch: this.batch.bind(this),
        getBookmark: () => null,
      };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  };
}

async function workspaceDb() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      picture TEXT,
      bio TEXT,
      email TEXT,
      trust_tier TEXT NOT NULL DEFAULT 'new',
      setup_completed INTEGER NOT NULL DEFAULT 0,
      default_repository_id TEXT,
      head_snapshot_id TEXT,
      ai_model TEXT,
      model_backend TEXT,
      security_posture TEXT NOT NULL DEFAULT 'standard',
      owner_account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE account_memberships (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO accounts (
      id, type, name, slug, email, owner_account_id, created_at, updated_at
    ) VALUES
      ('workspace', 'team', 'Workspace', 'workspace', NULL, 'old-owner', 't0', 't0'),
      ('old-owner', 'user', 'Old Owner', 'old-owner', 'old@example.test', 'old-owner', 't0', 't0'),
      ('next-owner', 'user', 'Next Owner', 'next-owner', 'next@example.test', 'next-owner', 't0', 't0'),
      ('third', 'user', 'Third', 'third', 'third@example.test', 'third', 't0', 't0');
    INSERT INTO account_memberships VALUES
      ('m1', 'workspace', 'old-owner', 'owner', 'active', 't0', 't0'),
      ('m2', 'workspace', 'next-owner', 'editor', 'active', 't0', 't0'),
      ('m3', 'workspace', 'third', 'viewer', 'active', 't0', 't0');
  `);
  return client;
}

test("Workspace response does not expose the legacy membership role", () => {
  const response = toWorkspaceResponse({
    id: "workspace",
    kind: "team",
    name: "Workspace",
    slug: "workspace",
    owner_principal_id: "owner",
    created_at: "t0",
    updated_at: "t0",
    member_role: "editor",
  } as never);
  expect(response).not.toHaveProperty("member_role");
  expect(response).not.toHaveProperty("kind");
  expect(response).not.toHaveProperty("owner_principal_id");
  expect(response).toHaveProperty("is_default", false);
});

test("legacy non-owner memberships grant no Workspace discovery or access", async () => {
  const client = await workspaceDb();
  try {
    const db = d1Binding(client);
    expect((await checkSpaceAccess(db, "workspace", "old-owner"))?.space.id)
      .toBe("workspace");
    expect(await checkSpaceAccess(db, "workspace", "next-owner")).toBeNull();

    await client.execute(
      "UPDATE account_memberships SET role = 'owner' WHERE member_id = 'next-owner'",
    );
    expect(await checkSpaceAccess(db, "workspace", "next-owner")).toBeNull();
    await client.execute(
      "UPDATE account_memberships SET role = 'editor' WHERE member_id = 'next-owner'",
    );

    await client.execute(
      "UPDATE account_memberships SET status = 'suspended' WHERE member_id = 'old-owner'",
    );
    expect(await checkSpaceAccess(db, "workspace", "old-owner")).toBeNull();
    await client.execute(
      "UPDATE account_memberships SET status = 'active' WHERE member_id = 'old-owner'",
    );

    await client.execute(
      "UPDATE accounts SET status = 'suspended' WHERE id = 'workspace'",
    );
    expect(await checkSpaceAccess(db, "workspace", "old-owner")).toBeNull();
    expect(await getWorkspaceByIdOrSlug(db, "workspace")).toBeNull();
    expect(
      await listWorkspacesForUser({ DB: db } as Env, "old-owner"),
    ).toEqual([]);
    await client.execute(
      "UPDATE accounts SET status = 'active' WHERE id = 'workspace'",
    );

    await client.execute(
      "UPDATE accounts SET status = 'suspended' WHERE id = 'old-owner'",
    );
    expect(await checkSpaceAccess(db, "workspace", "old-owner")).toBeNull();
    expect(
      await listWorkspacesForUser({ DB: db } as Env, "old-owner"),
    ).toEqual([]);
    await client.execute(
      "UPDATE accounts SET status = 'active' WHERE id = 'old-owner'",
    );

    const ownerWorkspaces = await listWorkspacesForUser(
      { DB: db } as Env,
      "old-owner",
    );
    expect(ownerWorkspaces.map((workspace) => workspace.id)).toEqual([
      "workspace",
    ]);
    expect(ownerWorkspaces[0]).not.toHaveProperty("member_role");
    expect(
      await listWorkspacesForUser({ DB: db } as Env, "next-owner"),
    ).toEqual([]);
  } finally {
    client.close();
  }
});
