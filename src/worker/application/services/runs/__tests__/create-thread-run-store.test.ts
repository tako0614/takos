import { expect, test } from "bun:test";
import { createClient, type Client, type ResultSet } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
} from "../../../../shared/types/bindings.ts";
import { checkRunRateLimits } from "../create-thread-run-store.ts";

type NonAuthoritativeWitness = {
  name: string;
  principalStatus: "active" | "suspended";
  ownerAccountId: "principal" | "other";
  role: "owner" | "editor";
  status: "active" | "suspended";
};

const nonAuthoritativeWitnesses: NonAuthoritativeWitness[] = [
  {
    name: "a foreign owner witness",
    principalStatus: "active",
    ownerAccountId: "other",
    role: "owner",
    status: "active",
  },
  {
    name: "an editor witness",
    principalStatus: "active",
    ownerAccountId: "other",
    role: "editor",
    status: "active",
  },
  {
    name: "a suspended owner witness",
    principalStatus: "active",
    ownerAccountId: "principal",
    role: "owner",
    status: "suspended",
  },
  {
    name: "an owner witness for a suspended Principal",
    principalStatus: "suspended",
    ownerAccountId: "principal",
    role: "owner",
    status: "active",
  },
];

const now = Date.parse("2026-08-27T12:00:00.000Z");
const clock = { now: () => now };

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
        const result = await client.execute({
          sql,
          args: statement.args as never[],
        });
        return (result.rows[0] as T | undefined) ?? null;
      },
      async run<T = Record<string, unknown>>() {
        return toSqlResult(
          await client.execute({ sql, args: statement.args as never[] }),
        ) as SqlResultBinding<T>;
      },
      async all<T = Record<string, unknown>>() {
        return toSqlResult(
          await client.execute({ sql, args: statement.args as never[] }),
        ) as SqlResultBinding<T>;
      },
      async raw<T = unknown[]>() {
        const result = await client.execute({
          sql,
          args: statement.args as never[],
        });
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
        args: statement.args as never[],
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

function invalidArrayBufferDrizzleBinding(
  client: Client,
): SqlDatabaseBinding {
  return Object.assign(d1Binding(client), {
    select() {
      throw new Error("Invalid array buffer length");
    },
    insert() {},
    update() {},
    delete() {},
  }) as SqlDatabaseBinding;
}

async function createRateLimitFixture(
  witness: NonAuthoritativeWitness,
): Promise<Client> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
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
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      parent_run_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  await client.batch([
    {
      sql: `INSERT INTO accounts
        (id, type, status, name, slug, owner_account_id, created_at, updated_at)
        VALUES ('principal', 'user', ?, 'Principal', 'principal', 'principal', 't0', 't0')`,
      args: [witness.principalStatus],
    },
    {
      sql: `INSERT INTO accounts
        (id, type, status, name, slug, owner_account_id, created_at, updated_at)
        VALUES ('other', 'user', 'active', 'Other', 'other', 'other', 't0', 't0')`,
      args: [],
    },
    {
      sql: `INSERT INTO accounts
        (id, type, status, name, slug, owner_account_id, created_at, updated_at)
        VALUES ('owned', 'team', 'active', 'Owned', 'owned', 'principal', 't0', 't0')`,
      args: [],
    },
    {
      sql: `INSERT INTO accounts
        (id, type, status, name, slug, owner_account_id, created_at, updated_at)
        VALUES ('busy', 'team', 'active', 'Busy', 'busy', ?, 't0', 't0')`,
      args: [witness.ownerAccountId],
    },
    {
      sql: `INSERT INTO account_memberships
        (id, account_id, member_id, role, status, created_at, updated_at)
        VALUES ('owned-owner', 'owned', 'principal', 'owner', 'active', 't0', 't0')`,
      args: [],
    },
    {
      sql: `INSERT INTO account_memberships
        (id, account_id, member_id, role, status, created_at, updated_at)
        VALUES ('busy-candidate', 'busy', 'principal', ?, ?, 't0', 't0')`,
      args: [witness.role, witness.status],
    },
    {
      sql: `INSERT INTO account_memberships
        (id, account_id, member_id, role, status, created_at, updated_at)
        VALUES ('busy-owner', 'busy', 'other', 'owner', 'active', 't0', 't0')`,
      args: [],
    },
  ]);

  const runValues = Array.from(
    { length: 30 },
    (_, index) =>
      `('busy-run-${index}', 'busy', NULL, 'completed', '2026-08-27T11:59:30.000Z')`,
  ).join(",\n");
  await client.execute(`
    INSERT INTO runs (id, account_id, parent_run_id, status, created_at)
    VALUES ${runValues}
  `);
  return client;
}

for (const witness of nonAuthoritativeWitnesses) {
  test(`Drizzle quota scope ignores ${witness.name}`, async () => {
    const client = await createRateLimitFixture(witness);
    try {
      const db = drizzle(client, { schema });
      const result = await checkRunRateLimits(
        db as never,
        "principal",
        "owned",
        {},
        clock,
      );
      expect(result).toEqual({ allowed: true });
    } finally {
      client.close();
    }
  });

  test(`SQL fallback quota scope ignores ${witness.name}`, async () => {
    const client = await createRateLimitFixture(witness);
    try {
      const db = invalidArrayBufferDrizzleBinding(client);
      const result = await checkRunRateLimits(
        db,
        "principal",
        "owned",
        {},
        clock,
      );
      expect(result).toEqual({ allowed: true });
    } finally {
      client.close();
    }
  });
}
