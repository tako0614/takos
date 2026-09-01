import { test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import * as schema from "../../../../infra/db/schema.ts";
import { validateCustomSkillMetadata } from "../../agent/managed-skills.ts";

import { assertEquals, assertNotEquals } from "@takos/test/assert";

import {
  createSkill,
  deleteSkill,
  formatSkill,
  getSkill,
  type getSkillByName,
  listSkills,
  parseSkillMetadata,
  parseTriggers,
  type SkillRow,
  updateSkill,
  updateSkillEnabled,
} from "../skills.ts";

type QueryKind = "first" | "all" | "run" | "raw";

type PreparedStatementRecord = {
  sql: string;
  args: unknown[];
  methods: QueryKind[];
};

function createFakeSqlDatabase(
  onQuery: (
    call: { sql: string; args: unknown[]; method: QueryKind },
  ) => { rows?: unknown[][] } = () => ({ rows: [] }),
) {
  const prepared: PreparedStatementRecord[] = [];
  const db = {
    prepare(sql: string) {
      const record: PreparedStatementRecord = { sql, args: [], methods: [] };
      prepared.push(record);

      let statement: {
        bind(...values: unknown[]): typeof statement;
        first<T = Record<string, unknown>>(): Promise<T | null>;
        all<T = Record<string, unknown>>(): Promise<
          { results: T[]; success: true; meta: Record<string, unknown> }
        >;
        run<T = Record<string, unknown>>(): Promise<
          { results: T[]; success: true; meta: Record<string, unknown> }
        >;
        raw<T = unknown[]>(
          options?: { columnNames?: boolean },
        ): Promise<T[] | [string[], ...T[]]>;
      };

      statement = {
        bind(...values: unknown[]) {
          record.args = values;
          return statement;
        },
        async first<T = Record<string, unknown>>() {
          record.methods.push("first");
          const { rows } = onQuery({
            sql: record.sql,
            args: [...record.args],
            method: "first",
          });
          return (rows?.[0] ?? null) as T | null;
        },
        async all<T = Record<string, unknown>>() {
          record.methods.push("all");
          const { rows } = onQuery({
            sql: record.sql,
            args: [...record.args],
            method: "all",
          });
          return {
            results: (rows ?? []) as T[],
            success: true as const,
            meta: {
              changed_db: false,
              changes: 0,
              duration: 0,
              last_row_id: 0,
              rows_read: 0,
              rows_written: 0,
              served_by: "test",
              size_after: 0,
            },
          };
        },
        async run<T = Record<string, unknown>>() {
          record.methods.push("run");
          const { rows } = onQuery({
            sql: record.sql,
            args: [...record.args],
            method: "run",
          });
          return {
            results: (rows ?? []) as T[],
            success: true as const,
            meta: {
              changed_db: false,
              changes: 0,
              duration: 0,
              last_row_id: 0,
              rows_read: 0,
              rows_written: 0,
              served_by: "test",
              size_after: 0,
            },
          };
        },
        async raw<T = unknown[]>(options?: { columnNames?: boolean }) {
          record.methods.push("raw");
          if (options?.columnNames) {
            return [[]] as [string[], ...T[]];
          }
          const { rows } = onQuery({
            sql: record.sql,
            args: [...record.args],
            method: "raw",
          });
          return (rows ?? []) as T[];
        },
      };

      return statement;
    },
    async batch<T = Record<string, unknown>>(
      statements: Array<
        {
          run(): Promise<
            { results: T[]; success: true; meta: Record<string, unknown> }
          >;
        }
      >,
    ) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    withSession() {
      return db;
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as SqlDatabaseBinding & { prepared: PreparedStatementRecord[] };

  return { db, prepared };
}

function createSkillRow(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: "s1",
    spaceId: "ws-1",
    name: "my-skill",
    description: "A skill",
    instructions: "Do this",
    triggers: "hello,world",
    metadata: "{}",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function toSkillRawRow(skill: {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  instructions: string;
  triggers: string | null;
  metadata: string | null;
  enabled: boolean | number;
  createdAt: string;
  updatedAt: string;
}) {
  return [
    skill.id,
    skill.accountId,
    skill.name,
    skill.description,
    skill.instructions,
    skill.triggers,
    skill.metadata,
    skill.enabled ? 1 : 0,
    skill.createdAt,
    skill.updatedAt,
  ];
}

test("parseTriggers - parses comma-separated triggers", () => {
  assertEquals(parseTriggers("hello, world, test"), ["hello", "world", "test"]);
});

test("parseTriggers - returns empty array for null", () => {
  assertEquals(parseTriggers(null), []);
});

test("parseTriggers - filters empty strings", () => {
  assertEquals(parseTriggers("a,,b,"), ["a", "b"]);
});

test("parseSkillMetadata - returns empty object for null/undefined", () => {
  assertEquals(parseSkillMetadata(null), {});
  assertEquals(parseSkillMetadata(undefined), {});
});

test("parseSkillMetadata - returns empty object for empty string", () => {
  assertEquals(parseSkillMetadata(""), {});
  assertEquals(parseSkillMetadata("  "), {});
});

test("parseSkillMetadata - returns empty object for invalid JSON", () => {
  assertEquals(parseSkillMetadata("not json"), {});
});

test("parseSkillMetadata - parses valid JSON metadata", () => {
  const result = parseSkillMetadata('{"category":"research"}');
  assertEquals(result.category, "research");
});

test("custom Skill resource manifests reject overflow and duplicate template ids", () => {
  const overflow = validateCustomSkillMetadata({
    execution_contract: {
      template_ids: Array.from({ length: 9 }, (_, index) => `template-${index}`),
    },
  });
  assertEquals(
    overflow.fieldErrors["execution_contract.template_ids"],
    "template_ids must contain at most 8 resources",
  );
  const duplicate = validateCustomSkillMetadata({
    execution_contract: {
      template_ids: ["research-brief", "research-brief"],
    },
  });
  assertEquals(
    duplicate.fieldErrors["execution_contract.template_ids"],
    "template_ids must not contain duplicates",
  );
});

test("formatSkill - formats a skill row", () => {
  const skill = createSkillRow();

  const result = formatSkill(skill);
  assertEquals(result.id, "s1");
  assertEquals(result.name, "my-skill");
  assertEquals(result.triggers, ["hello", "world"]);
  assertEquals(result.source, "custom");
  assertEquals(result.editable, true);
});

test("listSkills - returns formatted skills", async () => {
  const { db } = createFakeSqlDatabase((call) => {
    if (call.sql.includes("mcp_servers")) {
      return { rows: [] };
    }
    if (
      call.sql.includes("skills") && call.method === "raw" &&
      call.sql.startsWith("select")
    ) {
      return {
        rows: [
          toSkillRawRow({
            id: "s1",
            accountId: "ws-1",
            name: "skill-1",
            description: null,
            instructions: "test",
            triggers: null,
            metadata: "{}",
            enabled: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ],
      };
    }
    return { rows: [] };
  });

  const result = await listSkills(db, "ws-1");
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "skill-1");
  assertEquals(result[0].source, "custom");
});

test("getSkill - returns null when not found", async () => {
  const { db } = createFakeSqlDatabase();

  const result = await getSkill(db, "ws-1", "nonexistent");
  assertEquals(result, null);
});

test("getSkill - returns skill row when found", async () => {
  const { db } = createFakeSqlDatabase((call) => {
    if (
      call.sql.includes("skills") && call.method === "raw" &&
      call.sql.startsWith("select")
    ) {
      return {
        rows: [
          toSkillRawRow({
            id: "s1",
            accountId: "ws-1",
            name: "skill-1",
            description: null,
            instructions: "test",
            triggers: null,
            metadata: null,
            enabled: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ],
      };
    }
    return { rows: [] };
  });

  const result = await getSkill(db, "ws-1", "s1");
  assertNotEquals(result, null);
  assertEquals(result!.id, "s1");
});

test("createSkill - creates skill with trimmed values", async () => {
  const { db, prepared } = createFakeSqlDatabase((call) => {
    if (call.sql.includes("mcp_servers")) {
      return { rows: [] };
    }
    if (call.sql.includes("skills") && call.sql.startsWith("insert")) {
      return {
        rows: [
          toSkillRawRow({
            id: "skill-new",
            accountId: "ws-1",
            name: "new-skill",
            description: "desc",
            instructions: "do stuff",
            triggers: "a,b",
            metadata: "{}",
            enabled: true,
            createdAt: "2026-03-24T00:00:00.000Z",
            updatedAt: "2026-03-24T00:00:00.000Z",
          }),
        ],
      };
    }
    return { rows: [] };
  });

  const result = await createSkill(db, "ws-1", {
    name: "  new-skill  ",
    description: "  desc  ",
    instructions: "  do stuff  ",
    triggers: ["a", "b"],
  });

  assertNotEquals(result, null);
  assertEquals(result!.id, "skill-new");
  assertEquals(
    prepared.some((record) =>
      record.sql.includes("insert") && record.sql.includes("skills")
    ),
    true,
  );
  assertEquals(prepared[0].args.includes("ws-1"), true);
});

test("updateSkill - returns null when skill not found", async () => {
  const { db } = createFakeSqlDatabase();

  const result = await updateSkill(db, "ws-1", "nonexistent", { name: "new" });
  assertEquals(result, null);
});

test("deleteSkill - deletes skill by id", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE skills (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        name TEXT NOT NULL,
        description TEXT,
        instructions TEXT NOT NULL,
        triggers TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_resource_tombstones (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        resource_kind TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        deleted_by_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        deleted_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (account_id, resource_kind, resource_id)
      );
      CREATE TABLE agent_resource_deletion_outbox (
        id TEXT PRIMARY KEY NOT NULL REFERENCES agent_resource_tombstones(id)
          ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
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
        updated_at TEXT NOT NULL,
        UNIQUE (account_id, resource_kind, resource_id)
      );
      INSERT INTO accounts (id) VALUES ('ws-1'), ('user-1');
      INSERT INTO skills (
        id, account_id, name, description, instructions, triggers, metadata,
        enabled, created_at, updated_at
      ) VALUES (
        's1', 'ws-1', 'my-skill', 'A skill', 'Do this', 'hello,world',
        '{}', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
    `);
    const db = drizzle(client, { schema }) as unknown as SqlDatabaseBinding;
    const deleted = await deleteSkill(db, "ws-1", "s1", "user-1");
    assertNotEquals(deleted, null);

    const rows = await client.execute(`
      SELECT t.resource_kind, t.resource_id, t.deleted_by_account_id,
             o.delivery_status
      FROM agent_resource_tombstones t
      JOIN agent_resource_deletion_outbox o ON o.id = t.id
    `);
    assertEquals(rows.rows.length, 1);
    assertEquals(rows.rows[0]?.resource_kind, "skill_revision");
    assertEquals(rows.rows[0]?.deleted_by_account_id, "user-1");
    assertEquals(rows.rows[0]?.delivery_status, "pending");
    assertEquals(
      Number((await client.execute("SELECT COUNT(*) AS count FROM skills"))
        .rows[0]?.count),
      0,
    );

    const retry = await deleteSkill(db, "ws-1", "s1", "user-1");
    assertEquals(retry, deleted);
  } finally {
    client.close();
  }
});

test("updateSkillEnabled - returns the new enabled state", async () => {
  const { db, prepared } = createFakeSqlDatabase();

  const result = await updateSkillEnabled(db, "ws-1", "s1", false);
  assertEquals(result, false);
  assertEquals(
    prepared.some((record) =>
      record.sql.includes("update") && record.sql.includes("skills") &&
      record.args.includes("ws-1") && record.args.includes("s1")
    ),
    true,
  );
});
