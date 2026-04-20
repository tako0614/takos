import { assertEquals } from "jsr:@std/assert";
import { Hono } from "hono";

import { appsRouteDeps, registerAppApiRoutes } from "../apps.ts";

type PreparedRecord = {
  sql: string;
  args: unknown[];
  method: "all" | "first" | "run" | "raw" | "";
};

type AppRow = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  appType: string | null;
  accountId: string;
  serviceHostname: string | null;
  serviceStatus: string | null;
  accountName: string | null;
  accountSlug: string | null;
  accountType: string | null;
  takosClientKey: string | null;
  createdAt: string;
  updatedAt: string;
};

function createFakeD1Database(initialRows: AppRow[]) {
  const rows = initialRows.map((row) => ({ ...row }));
  const prepared: PreparedRecord[] = [];

  const db = {
    prepared,
    prepare(sql: string) {
      const record: PreparedRecord = { sql, args: [], method: "" };
      prepared.push(record);

      const statement = {
        bind(...values: unknown[]) {
          record.args = values;
          return statement;
        },
        async all() {
          record.method = "all";
          return {
            results: selectRows(record, rows),
            success: true as const,
            meta: emptyMeta(),
          };
        },
        async first<T = Record<string, unknown>>() {
          record.method = "first";
          return (selectRows(record, rows)[0] ?? null) as T | null;
        },
        async run() {
          record.method = "run";
          return {
            results: [],
            success: true as const,
            meta: emptyMeta(),
          };
        },
        async raw() {
          record.method = "raw";
          const row = selectRows(record, rows)[0];
          if (!row) return [];

          const sql = record.sql.toLowerCase();
          if (sql.includes("takos_client_key")) {
            return [[
              row.id,
              row.name,
              row.description,
              row.icon,
              row.appType,
              row.takosClientKey,
              row.createdAt,
              row.updatedAt,
              row.serviceHostname,
              row.serviceStatus,
              row.accountName,
              row.accountSlug,
              row.accountType,
            ]];
          }

          return [[
            row.id,
            row.name,
            row.description,
            row.icon,
            row.appType,
            row.accountId,
            row.serviceHostname,
            row.serviceStatus,
            row.accountName,
            row.accountSlug,
            row.accountType,
          ]];
        },
      };

      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return await Promise.all(statements.map((statement) => statement.run()));
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
  };

  function selectRows(record: PreparedRecord, source: AppRow[]) {
    const sql = record.sql.toLowerCase();
    if (!sql.includes("apps")) return [];

    const appId = record.args.find((value) =>
      typeof value === "string" && source.some((row) => row.id === value)
    ) as string | undefined;
    const accountId = record.args.find((value) =>
      typeof value === "string" &&
      source.some((row) => row.accountId === value)
    ) as string | undefined;

    if (appId && accountId) {
      return source.filter((row) =>
        row.id === appId && row.accountId === accountId
      );
    }

    if (accountId) {
      return source.filter((row) => row.accountId === accountId);
    }

    return [];
  }

  function emptyMeta() {
    return {
      changed_db: false,
      changes: 0,
      duration: 0,
      last_row_id: 0,
      rows_read: 0,
      rows_written: 0,
      served_by: "test",
      size_after: 0,
    };
  }

  return { db, prepared, rows };
}

Deno.test(
  "app mutations resolve the requested space before looking up the app",
  async () => {
    const originalRequireSpaceAccess = appsRouteDeps.requireSpaceAccess;
    const accessCalls: Array<{ spaceId: string; userId: string }> = [];

    const { db, prepared } = createFakeD1Database([
      {
        id: "app-space-1",
        name: "space-app",
        description: "Workspace app",
        icon: "📦",
        appType: "custom",
        accountId: "space-123",
        serviceHostname: null,
        serviceStatus: null,
        accountName: "Workspace",
        accountSlug: "workspace",
        accountType: "workspace",
        takosClientKey: null,
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
    ]);

    const app = new Hono<{
      Bindings: { DB: unknown };
      Variables: {
        user: { id: string; principal_id: string };
      };
    }>();

    app.use("*", async (c, next) => {
      c.set("user", {
        id: "user-1",
        principal_id: "principal-1",
      });
      await next();
    });

    registerAppApiRoutes(app as never);

    try {
      appsRouteDeps.requireSpaceAccess = async (_c, spaceId, userId) => {
        accessCalls.push({ spaceId, userId });
        return {
          space: { id: "space-123" },
        } as never;
      };

      const env = { DB: db };

      const headers = {
        "Content-Type": "application/json",
        "X-Takos-Space-Id": "space-123",
      };

      const patchResponse = await app.request("/apps/app-space-1", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ description: "Updated" }),
      }, env);
      assertEquals(patchResponse.status, 200);

      const clientKeyResponse = await app.request(
        "/apps/app-space-1/client-key",
        {
          method: "POST",
          headers: {
            "X-Takos-Space-Id": "space-123",
          },
        },
        env,
      );
      assertEquals(clientKeyResponse.status, 200);

      const deleteResponse = await app.request("/apps/app-space-1", {
        method: "DELETE",
        headers: {
          "X-Takos-Space-Id": "space-123",
        },
      }, env);
      assertEquals(deleteResponse.status, 200);

      assertEquals(accessCalls, [
        { spaceId: "space-123", userId: "user-1" },
        { spaceId: "space-123", userId: "user-1" },
        { spaceId: "space-123", userId: "user-1" },
      ]);

      const selectCalls = prepared.filter((entry) =>
        entry.sql.trim().toLowerCase().startsWith("select")
      );
      assertEquals(selectCalls.length >= 3, true);
      assertEquals(
        selectCalls.every((entry) => entry.args.includes("space-123")),
        true,
      );
    } finally {
      appsRouteDeps.requireSpaceAccess = originalRequireSpaceAccess;
    }
  },
);
