import type { D1Database } from "../../../../shared/types/bindings.ts";

import { assertEquals, assertNotEquals } from "jsr:@std/assert";

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

function createFakeD1Database(
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
  } as unknown as D1Database & { prepared: PreparedStatementRecord[] };

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

Deno.test("parseTriggers - parses comma-separated triggers", () => {
  assertEquals(parseTriggers("hello, world, test"), ["hello", "world", "test"]);
});

Deno.test("parseTriggers - returns empty array for null", () => {
  assertEquals(parseTriggers(null), []);
});

Deno.test("parseTriggers - filters empty strings", () => {
  assertEquals(parseTriggers("a,,b,"), ["a", "b"]);
});

Deno.test("parseSkillMetadata - returns empty object for null/undefined", () => {
  assertEquals(parseSkillMetadata(null), {});
  assertEquals(parseSkillMetadata(undefined), {});
});

Deno.test("parseSkillMetadata - returns empty object for empty string", () => {
  assertEquals(parseSkillMetadata(""), {});
  assertEquals(parseSkillMetadata("  "), {});
});

Deno.test("parseSkillMetadata - returns empty object for invalid JSON", () => {
  assertEquals(parseSkillMetadata("not json"), {});
});

Deno.test("parseSkillMetadata - parses valid JSON metadata", () => {
  const result = parseSkillMetadata('{"category":"research"}');
  assertEquals(result.category, "research");
});

Deno.test("formatSkill - formats a skill row", () => {
  const skill = createSkillRow();

  const result = formatSkill(skill);
  assertEquals(result.id, "s1");
  assertEquals(result.name, "my-skill");
  assertEquals(result.triggers, ["hello", "world"]);
  assertEquals(result.source, "custom");
  assertEquals(result.editable, true);
});

Deno.test("listSkills - returns formatted skills", async () => {
  const { db } = createFakeD1Database((call) => {
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

Deno.test("getSkill - returns null when not found", async () => {
  const { db } = createFakeD1Database();

  const result = await getSkill(db, "ws-1", "nonexistent");
  assertEquals(result, null);
});

Deno.test("getSkill - returns skill row when found", async () => {
  const { db } = createFakeD1Database((call) => {
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

Deno.test("createSkill - creates skill with trimmed values", async () => {
  const { db, prepared } = createFakeD1Database((call) => {
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

Deno.test("updateSkill - returns null when skill not found", async () => {
  const { db } = createFakeD1Database();

  const result = await updateSkill(db, "ws-1", "nonexistent", { name: "new" });
  assertEquals(result, null);
});

Deno.test("deleteSkill - deletes skill by id", async () => {
  const { db, prepared } = createFakeD1Database();

  await deleteSkill(db, "s1");
  assertEquals(
    prepared.some((record) =>
      record.sql.includes("delete") && record.sql.includes("skills")
    ),
    true,
  );
});

Deno.test("updateSkillEnabled - returns the new enabled state", async () => {
  const { db, prepared } = createFakeD1Database();

  const result = await updateSkillEnabled(db, "s1", false);
  assertEquals(result, false);
  assertEquals(
    prepared.some((record) =>
      record.sql.includes("update") && record.sql.includes("skills")
    ),
    true,
  );
});
