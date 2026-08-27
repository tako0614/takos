import { expect, test } from "bun:test";
import { createClient, type Client, type ResultSet } from "@libsql/client";

import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
} from "../../shared/types/bindings.ts";
import { createWorkspaceCore } from "../../../core/workspaces/index.ts";
import {
  createSqlWorkspacePersistence,
  updateSqlWorkspaceModelSettings,
} from "./sql-workspace-persistence.ts";

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

async function legacyWorkspaceDb(): Promise<Client> {
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
      id, type, status, name, slug, owner_account_id, created_at, updated_at
    ) VALUES
      ('workspace', 'team', 'active', 'Workspace', 'workspace', 'owner', 't0', 't0'),
      ('owner', 'user', 'active', 'Owner', 'owner', NULL, 't0', 't0'),
      ('other', 'user', 'active', 'Other', 'other', NULL, 't0', 't0');
    INSERT INTO account_memberships VALUES
      ('m-owner', 'workspace', 'owner', 'owner', 'active', 't0', 't0'),
      ('m-other', 'workspace', 'other', 'editor', 'active', 't0', 't0');
  `);
  return client;
}

test("legacy rows grant access only to the active matching owner", async () => {
  const client = await legacyWorkspaceDb();
  try {
    const persistence = createSqlWorkspacePersistence(d1Binding(client));

    expect((await persistence.resolveForPrincipal("owner", "workspace"))?.id)
      .toBe("workspace");
    expect(await persistence.listForPrincipal("owner")).toHaveLength(1);
    expect(await persistence.resolveForPrincipal("other", "workspace"))
      .toBeNull();

    await client.execute(
      "UPDATE account_memberships SET role = 'owner' WHERE member_id = 'other'",
    );
    expect(await persistence.resolveForPrincipal("other", "workspace"))
      .toBeNull();

    await client.execute(
      "UPDATE account_memberships SET status = 'suspended' WHERE member_id = 'owner'",
    );
    expect(await persistence.resolveForPrincipal("owner", "workspace"))
      .toBeNull();
    await client.execute(
      "UPDATE account_memberships SET status = 'active' WHERE member_id = 'owner'",
    );

    await client.execute(
      "UPDATE accounts SET status = 'suspended' WHERE id = 'workspace'",
    );
    expect(await persistence.listForPrincipal("owner")).toEqual([]);
    await client.execute(
      "UPDATE accounts SET status = 'active' WHERE id = 'workspace'",
    );

    await client.execute(
      "UPDATE accounts SET status = 'suspended' WHERE id = 'owner'",
    );
    expect(await persistence.resolveForPrincipal("owner", "workspace"))
      .toBeNull();
  } finally {
    client.close();
  }
});

test("system accounts never become Workspaces through forged legacy rows", async () => {
  const client = await legacyWorkspaceDb();
  try {
    await client.executeMultiple(`
      INSERT INTO accounts (
        id, type, status, name, slug, owner_account_id, created_at, updated_at
      ) VALUES (
        'system-account', 'system', 'active', 'System', 'system-account',
        'owner', 't0', 't0'
      );
      INSERT INTO account_memberships VALUES (
        'm-system', 'system-account', 'owner', 'owner', 'active', 't0', 't0'
      );
    `);
    const persistence = createSqlWorkspacePersistence(d1Binding(client));

    expect(await persistence.resolveForPrincipal("owner", "system-account"))
      .toBeNull();
    expect((await persistence.listForPrincipal("owner")).map((row) => row.id))
      .not.toContain("system-account");
  } finally {
    client.close();
  }
});

test("the core creates an owner-only Workspace through the SQL adapter", async () => {
  const client = await legacyWorkspaceDb();
  try {
    const persistence = createSqlWorkspacePersistence(d1Binding(client), {
      nextLegacyWitnessId: () => "membership-new",
    });
    const workspaces = createWorkspaceCore({
      persistence,
      clock: { now: () => "2026-08-27T12:00:00.000Z" },
      ids: { nextWorkspaceId: () => "workspace-new" },
    });

    const created = await workspaces.create("owner", {
      name: "New private Workspace",
      description: "Owner only",
    });

    expect(created).toMatchObject({
      id: "workspace-new",
      slug: "new-private-workspace",
      description: "Owner only",
      isDefault: false,
    });
    expect((await workspaces.list("owner")).map((row) => row.id)).toContain(
      "workspace-new",
    );
    expect(await workspaces.resolve("other", "workspace-new")).toBeNull();
  } finally {
    client.close();
  }
});

test("the core updates and deletes only through an active owner proof", async () => {
  const client = await legacyWorkspaceDb();
  try {
    let now = "2026-08-27T12:00:00.000Z";
    const persistence = createSqlWorkspacePersistence(d1Binding(client), {
      nextLegacyWitnessId: () => "membership-new",
    });
    const workspaces = createWorkspaceCore({
      persistence,
      clock: { now: () => now },
      ids: { nextWorkspaceId: () => "workspace-new" },
    });
    await workspaces.create("owner", { name: "Private" });

    expect(
      await workspaces.update("other", "workspace-new", { name: "Spoofed" }),
    ).toBeNull();
    now = "2026-08-27T13:00:00.000Z";
    expect(
      await workspaces.update("owner", "workspace-new", {
        name: "Renamed",
        description: "Updated",
        securityPosture: "restricted_egress",
      }),
    ).toMatchObject({
      name: "Renamed",
      description: "Updated",
      securityPosture: "restricted_egress",
      updatedAt: now,
    });

    await client.execute(
      "UPDATE account_memberships SET status = 'suspended' WHERE id = 'membership-new'",
    );
    expect(await workspaces.delete("owner", "workspace-new")).toBe(false);
    await client.execute(
      "UPDATE account_memberships SET status = 'active' WHERE id = 'membership-new'",
    );

    expect(await workspaces.delete("owner", "workspace-new")).toBe(true);
    const witnessCount = await client.execute(
      "SELECT COUNT(*) AS count FROM account_memberships WHERE account_id = 'workspace-new'",
    );
    expect(Number(witnessCount.rows[0]?.count ?? -1)).toBe(0);
  } finally {
    client.close();
  }
});

test("Worker model settings use the same Principal owner proof", async () => {
  const client = await legacyWorkspaceDb();
  try {
    const db = d1Binding(client);

    expect(
      await updateSqlWorkspaceModelSettings(db, "other", "workspace", {
        model: "claude-sonnet-4-5",
        backend: "anthropic",
        updatedAt: "t1",
      }),
    ).toBe(false);
    expect(
      await updateSqlWorkspaceModelSettings(db, "owner", "workspace", {
        model: "claude-sonnet-4-5",
        backend: "anthropic",
        updatedAt: "t1",
      }),
    ).toBe(true);

    await client.execute(
      "INSERT INTO account_memberships VALUES ('m-default', 'owner', 'owner', 'owner', 'active', 't0', 't0')",
    );
    expect(
      await updateSqlWorkspaceModelSettings(db, "owner", "owner", {
        model: "gemini-2.5-pro",
        backend: "google",
        updatedAt: "t2",
      }),
    ).toBe(true);

    const rows = await client.execute(
      "SELECT id, ai_model, model_backend FROM accounts WHERE id IN ('workspace', 'owner') ORDER BY id",
    );
    expect(rows.rows).toEqual([
      { id: "owner", ai_model: "gemini-2.5-pro", model_backend: "google" },
      {
        id: "workspace",
        ai_model: "claude-sonnet-4-5",
        model_backend: "anthropic",
      },
    ]);
  } finally {
    client.close();
  }
});
