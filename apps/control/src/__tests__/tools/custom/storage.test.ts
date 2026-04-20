import type { ToolContext } from "@/tools/types";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/tools/custom/storage/validators'
// [Deno] vi.mock removed - manually stub imports from '@/services/platform/infra'
// [Deno] vi.mock removed - manually stub imports from '@/platform/backends/cloudflare/wfp'
// [Deno] vi.mock removed - manually stub imports from '@/platform/backends/cloudflare/api-client'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/hash'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import {
  createKeyValueHandler,
  createObjectStoreHandler,
  createSqlHandler,
  KEY_VALUE_DELETE,
  KEY_VALUE_GET,
  KEY_VALUE_LIST,
  KEY_VALUE_PUT,
  keyValueDeleteHandler,
  keyValueGetHandler,
  keyValueListHandler,
  keyValuePutHandler,
  listResourcesHandler,
  OBJECT_STORE_INFO,
  OBJECT_STORE_LIST,
  OBJECT_STORE_UPLOAD,
  objectStoreDeleteHandler,
  objectStoreInfoHandler,
  objectStoreListHandler,
  SQL_DESCRIBE,
  SQL_QUERY,
  SQL_TABLES,
  sqlDescribeHandler,
  sqlQueryHandler,
  sqlTablesHandler,
  STORAGE_HANDLERS,
  STORAGE_TOOLS,
  storageResourceToolDeps,
} from "@/tools/custom/storage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockKV = {
  get: ((..._args: any[]) => undefined) as any,
  put: ((..._args: any[]) => undefined) as any,
  delete: ((..._args: any[]) => undefined) as any,
  list: ((..._args: any[]) => undefined) as any,
};

const mockR2 = {
  put: ((..._args: any[]) => undefined) as any,
  get: ((..._args: any[]) => undefined) as any,
  delete: ((..._args: any[]) => undefined) as any,
  list: ((..._args: any[]) => undefined) as any,
  head: ((..._args: any[]) => undefined) as any,
};

const mockStmt: any = {
  bind: () => mockStmt,
  all: async () => ({ results: [] }),
  run: async () => ({ meta: { changes: 1 } }),
  first: async () => null,
};

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: "ws-test",
    threadId: "thread-1",
    runId: "run-1",
    userId: "user-1",
    capabilities: [],
    env: {
      HOSTNAME_ROUTING: mockKV,
      TENANT_SOURCE: mockR2,
      TENANT_BUILDS: mockR2,
      WORKER_BUNDLES: mockR2,
      CF_ACCOUNT_ID: "cf-account",
      CF_API_TOKEN: "cf-token",
    } as unknown as Env,
    db: {
      prepare: () => mockStmt,
    } as unknown as D1Database,
    storage: {
      put: ((..._args: any[]) => undefined) as any,
      get: ((..._args: any[]) => undefined) as any,
      delete: ((..._args: any[]) => undefined) as any,
    } as unknown as ToolContext["storage"],
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Aggregate definitions
// ---------------------------------------------------------------------------

Deno.test("STORAGE_TOOLS and STORAGE_HANDLERS - exports combined tool list", () => {
  assert(STORAGE_TOOLS.length >= 11);
  const names = STORAGE_TOOLS.map((t) => t.name);
  assert(names.includes("key_value_get"));
  assert(names.includes("sql_query"));
  assert(names.includes("object_store_upload"));
  assert(names.includes("create_sql"));
  assert(names.includes("create_key_value"));
  assert(names.includes("create_object_store"));
  assert(names.includes("list_resources"));
});
Deno.test("STORAGE_TOOLS and STORAGE_HANDLERS - STORAGE_HANDLERS has handler for every tool", () => {
  for (const def of STORAGE_TOOLS) {
    assert(def.name in STORAGE_HANDLERS);
  }
});
// ---------------------------------------------------------------------------
// Resource lifecycle tools
// ---------------------------------------------------------------------------

Deno.test("createSqlHandler - provisions through managed resource lifecycle", async () => {
  const originalProvision = storageResourceToolDeps.provisionManagedResource;
  let receivedInput: Record<string, unknown> | undefined;
  storageResourceToolDeps.provisionManagedResource = (async (
    _env,
    input,
  ) => {
    receivedInput = input as unknown as Record<string, unknown>;
    return {
      id: "resource-1",
      backingResourceId: "sql-id",
      backingResourceName: "sql-name",
    };
  }) as typeof storageResourceToolDeps.provisionManagedResource;

  try {
    const result = await createSqlHandler({ name: "app-db" }, makeContext());

    assertEquals(receivedInput?.ownerId, "ws-test");
    assertEquals(receivedInput?.type, "sql");
    assertEquals(receivedInput?.publicType, "sql");
    assertEquals(receivedInput?.semanticType, "sql");
    assertStringIncludes(result, "sql-id");
  } finally {
    storageResourceToolDeps.provisionManagedResource = originalProvision;
  }
});

Deno.test("createKeyValueHandler - provisions a key-value resource", async () => {
  const originalProvision = storageResourceToolDeps.provisionManagedResource;
  let receivedInput: Record<string, unknown> | undefined;
  storageResourceToolDeps.provisionManagedResource = (async (
    _env,
    input,
  ) => {
    receivedInput = input as unknown as Record<string, unknown>;
    return {
      id: "resource-2",
      backingResourceId: "key-value-id",
      backingResourceName: "key-value-name",
    };
  }) as typeof storageResourceToolDeps.provisionManagedResource;

  try {
    const result = await createKeyValueHandler(
      { name: "session-cache" },
      makeContext(),
    );

    assertEquals(receivedInput?.type, "kv");
    assertEquals(receivedInput?.publicType, "key-value");
    assertEquals(receivedInput?.semanticType, "kv");
    assertStringIncludes(result, "key-value-id");
  } finally {
    storageResourceToolDeps.provisionManagedResource = originalProvision;
  }
});

Deno.test("createObjectStoreHandler - provisions an object-store resource", async () => {
  const originalProvision = storageResourceToolDeps.provisionManagedResource;
  let receivedInput: Record<string, unknown> | undefined;
  storageResourceToolDeps.provisionManagedResource = (async (
    _env,
    input,
  ) => {
    receivedInput = input as unknown as Record<string, unknown>;
    return {
      id: "resource-3",
      backingResourceId: "object-store-id",
      backingResourceName: "object-store-name",
    };
  }) as typeof storageResourceToolDeps.provisionManagedResource;

  try {
    const result = await createObjectStoreHandler(
      { name: "assets-store" },
      makeContext(),
    );

    assertEquals(receivedInput?.type, "object_store");
    assertEquals(receivedInput?.publicType, "object-store");
    assertEquals(receivedInput?.semanticType, "object_store");
    assertStringIncludes(result, "assets-store");
  } finally {
    storageResourceToolDeps.provisionManagedResource = originalProvision;
  }
});

Deno.test("listResourcesHandler - lists portable resource records from registry", async () => {
  const originalGetDb = storageResourceToolDeps.getDb;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            all: async () => [
              {
                name: "main-db",
                type: "d1",
                semanticType: "sql",
                backendName: "local",
                status: "active",
                backingResourceId: "sql-id",
                backingResourceName: "sql-name",
                config: "{}",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
              {
                name: "session-cache",
                type: "kv",
                semanticType: "kv",
                backendName: "local",
                status: "active",
                backingResourceId: "kv-id",
                backingResourceName: "kv-name",
                config: "{}",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        }),
      }),
    }),
  };
  storageResourceToolDeps.getDb = (() => db) as any;

  try {
    const result = await listResourcesHandler(
      { type: "key-value" },
      makeContext(),
    );

    assertStringIncludes(
      result,
      "session-cache (key-value, local, active) kv-id",
    );
    assert(!result.includes("main-db"));
  } finally {
    storageResourceToolDeps.getDb = originalGetDb;
  }
});

Deno.test("listResourcesHandler - rejects legacy resource type aliases", async () => {
  await assertRejects(async () => {
    await listResourcesHandler({ type: "kv" }, makeContext());
  }, "Unknown resource type: kv");
});
// ---------------------------------------------------------------------------
// Key-value tools
// ---------------------------------------------------------------------------

Deno.test("key-value tool definitions - key_value_get requires namespace and key", () => {
  assertEquals(KEY_VALUE_GET.parameters.required, ["namespace", "key"]);
  assertEquals(KEY_VALUE_GET.category, "storage");
});
Deno.test("key-value tool definitions - key_value_put requires namespace, key, and value", () => {
  assertEquals(KEY_VALUE_PUT.parameters.required, [
    "namespace",
    "key",
    "value",
  ]);
});
Deno.test("key-value tool definitions - key_value_delete requires namespace and key", () => {
  assertEquals(KEY_VALUE_DELETE.parameters.required, ["namespace", "key"]);
});
Deno.test("key-value tool definitions - key_value_list requires namespace", () => {
  assertEquals(KEY_VALUE_LIST.parameters.required, ["namespace"]);
});

Deno.test("keyValueGetHandler - returns value when key exists", async () => {
  mockKV.get = (async () => "my-value") as any;

  const result = await keyValueGetHandler(
    { namespace: "HOSTNAME_ROUTING", key: "test-key" },
    makeContext(),
  );
  assertEquals(result, "Value: my-value");
});
Deno.test("keyValueGetHandler - returns not found when key is null", async () => {
  mockKV.get = (async () => null) as any;

  const result = await keyValueGetHandler(
    { namespace: "HOSTNAME_ROUTING", key: "missing" },
    makeContext(),
  );
  assertStringIncludes(result, "Key not found");
});
Deno.test("keyValueGetHandler - throws when namespace is not found", async () => {
  await assertRejects(async () => {
    await keyValueGetHandler({ namespace: "UNKNOWN", key: "k" }, makeContext());
  }, "Key-value namespace not found");
});

Deno.test("keyValuePutHandler - stores a value", async () => {
  let receivedArgs: unknown[] | undefined;
  mockKV.put = (async (...args: unknown[]) => {
    receivedArgs = args;
  }) as any;

  const result = await keyValuePutHandler(
    { namespace: "HOSTNAME_ROUTING", key: "k", value: "v" },
    makeContext(),
  );
  assertEquals(result, "Stored: k");
  assertEquals(receivedArgs, ["k", "v", {}]);
});
Deno.test("keyValuePutHandler - passes TTL option", async () => {
  let receivedArgs: unknown[] | undefined;
  mockKV.put = (async (...args: unknown[]) => {
    receivedArgs = args;
  }) as any;

  await keyValuePutHandler(
    {
      namespace: "HOSTNAME_ROUTING",
      key: "k",
      value: "v",
      expiration_ttl: 3600,
    },
    makeContext(),
  );
  assertEquals(receivedArgs, ["k", "v", { expirationTtl: 3600 }]);
});
Deno.test("keyValuePutHandler - rejects invalid TTL", async () => {
  await assertRejects(async () => {
    await keyValuePutHandler(
      {
        namespace: "HOSTNAME_ROUTING",
        key: "k",
        value: "v",
        expiration_ttl: 10,
      },
      makeContext(),
    );
  }, "Invalid TTL");
});
Deno.test("keyValuePutHandler - rejects values exceeding 1MB", async () => {
  const largeValue = "x".repeat(1024 * 1024 + 1);
  await assertRejects(async () => {
    await keyValuePutHandler(
      { namespace: "HOSTNAME_ROUTING", key: "k", value: largeValue },
      makeContext(),
    );
  }, "exceeds maximum size");
});

Deno.test("keyValueDeleteHandler - deletes a key", async () => {
  mockKV.delete = (async () => undefined) as any;

  const result = await keyValueDeleteHandler(
    { namespace: "HOSTNAME_ROUTING", key: "k" },
    makeContext(),
  );
  assertEquals(result, "Deleted: k");
});

Deno.test("keyValueListHandler - lists keys", async () => {
  mockKV.list = (async () => ({
    keys: [
      { name: "key1" },
      { name: "key2", expiration: Math.floor(Date.now() / 1000) + 3600 },
    ],
    list_complete: true,
  })) as any;

  const result = await keyValueListHandler(
    { namespace: "HOSTNAME_ROUTING" },
    makeContext(),
  );
  assertStringIncludes(result, "key1");
  assertStringIncludes(result, "key2");
  assertStringIncludes(result, "expires:");
});
Deno.test("keyValueListHandler - reports empty namespace", async () => {
  mockKV.list = (async () => ({ keys: [], list_complete: true })) as any;

  const result = await keyValueListHandler(
    { namespace: "HOSTNAME_ROUTING" },
    makeContext(),
  );
  assertStringIncludes(result, "No keys found");
});
Deno.test("keyValueListHandler - shows truncation indicator", async () => {
  mockKV.list = (async () => ({
    keys: [{ name: "k1" }],
    list_complete: false,
  })) as any;

  const result = await keyValueListHandler(
    { namespace: "HOSTNAME_ROUTING" },
    makeContext(),
  );
  assertStringIncludes(result, "More keys available");
});
// ---------------------------------------------------------------------------
// SQL tools
// ---------------------------------------------------------------------------

Deno.test("sql tool definitions - sql_query requires sql", () => {
  assertEquals(SQL_QUERY.parameters.required, ["sql"]);
  assertEquals(SQL_QUERY.category, "storage");
});
Deno.test("sql tool definitions - sql_tables has no required params", () => {
  assertEquals(SQL_TABLES.parameters.required, undefined);
});
Deno.test("sql tool definitions - sql_describe requires table", () => {
  assertEquals(SQL_DESCRIBE.parameters.required, ["table"]);
});

Deno.test("sqlQueryHandler - executes a SELECT query and formats results", async () => {
  mockStmt.all = (async () => ({
    results: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ],
  } as never)) as any;

  const result = await sqlQueryHandler(
    { sql: "SELECT * FROM users" },
    makeContext(),
  );

  assertStringIncludes(result, "id");
  assertStringIncludes(result, "name");
  assertStringIncludes(result, "Alice");
  assertStringIncludes(result, "(2 rows)");
});
Deno.test("sqlQueryHandler - returns no results message for empty SELECT", async () => {
  mockStmt.all = (async () => ({ results: [] } as never)) as any;

  const result = await sqlQueryHandler(
    { sql: "SELECT * FROM users" },
    makeContext(),
  );
  assertEquals(result, "No results found.");
});
Deno.test("sqlQueryHandler - executes INSERT and reports changes", async () => {
  mockStmt.run = (async () => ({ meta: { changes: 1 } })) as any;

  const result = await sqlQueryHandler(
    { sql: "INSERT INTO users (name) VALUES ('test')" },
    makeContext(),
  );
  assertStringIncludes(result, "Changes: 1");
});
Deno.test("sqlQueryHandler - rejects DROP TABLE", async () => {
  await assertRejects(async () => {
    await sqlQueryHandler({ sql: "DROP TABLE users" }, makeContext());
  }, "Dangerous operation not allowed");
});
Deno.test("sqlQueryHandler - rejects TRUNCATE", async () => {
  await assertRejects(async () => {
    await sqlQueryHandler({ sql: "TRUNCATE users" }, makeContext());
  }, "Dangerous operation not allowed");
});
Deno.test("sqlQueryHandler - rejects PRAGMA", async () => {
  await assertRejects(async () => {
    await sqlQueryHandler({ sql: "PRAGMA table_info(users)" }, makeContext());
  }, "Dangerous operation not allowed");
});
Deno.test("sqlQueryHandler - rejects DELETE without WHERE", async () => {
  await assertRejects(async () => {
    await sqlQueryHandler({ sql: "DELETE FROM users" }, makeContext());
  }, "DELETE operations must include a WHERE clause");
});
Deno.test("sqlQueryHandler - allows DELETE with WHERE", async () => {
  mockStmt.run = (async () => ({ meta: { changes: 1 } })) as any;

  const result = await sqlQueryHandler(
    { sql: "DELETE FROM users WHERE id = 1" },
    makeContext(),
  );
  assertStringIncludes(result, "Changes: 1");
});
Deno.test("sqlQueryHandler - rejects UPDATE without WHERE", async () => {
  await assertRejects(async () => {
    await sqlQueryHandler(
      { sql: "UPDATE users SET name = 'test'" },
      makeContext(),
    );
  }, "UPDATE operations must include a WHERE clause");
});
Deno.test("sqlQueryHandler - rejects multiple SQL statements", async () => {
  await assertRejects(async () => {
    await sqlQueryHandler({ sql: "SELECT 1; SELECT 2" }, makeContext());
  }, "Multiple SQL statements not allowed");
});
Deno.test("sqlQueryHandler - rejects comment-based bypass for dangerous operations", async () => {
  await assertRejects(
    async () => {
      await sqlQueryHandler({ sql: "DR/**/OP TABLE users" }, makeContext());
    },
    "Only SELECT, INSERT, UPDATE (with WHERE), and DELETE (with WHERE) operations are allowed",
  );
});

Deno.test("sqlTablesHandler - lists tables and views", async () => {
  mockStmt.all = (async () => ({
    results: [
      { name: "users", type: "table" },
      { name: "user_view", type: "view" },
    ],
  } as never)) as any;

  const result = await sqlTablesHandler({}, makeContext());
  assertStringIncludes(result, "Tables (1)");
  assertStringIncludes(result, "users");
  assertStringIncludes(result, "Views (1)");
  assertStringIncludes(result, "user_view");
});
Deno.test("sqlTablesHandler - reports no tables found", async () => {
  mockStmt.all = (async () => ({ results: [] } as never)) as any;

  const result = await sqlTablesHandler({}, makeContext());
  assertEquals(result, "No tables found in database.");
});

Deno.test("sqlDescribeHandler - throws when table name is a reserved keyword", async () => {
  await assertRejects(async () => {
    await sqlDescribeHandler({ table: "select" }, makeContext());
  }, "reserved keyword");
});
Deno.test("sqlDescribeHandler - throws for invalid table names", async () => {
  await assertRejects(async () => {
    await sqlDescribeHandler({ table: "123abc" }, makeContext());
  }, "Invalid table name");
});
Deno.test("sqlDescribeHandler - throws for sqlite_ internal tables", async () => {
  await assertRejects(async () => {
    await sqlDescribeHandler({ table: "sqlite_master" }, makeContext());
  }, "Cannot access SQLite internal tables");
});
Deno.test("sqlDescribeHandler - throws when table does not exist", async () => {
  mockStmt.first = (async () => null as never) as any;

  await assertRejects(async () => {
    await sqlDescribeHandler({ table: "missing_table" }, makeContext());
  }, "Table not found");
});
Deno.test("sqlDescribeHandler - describes table with columns and indexes", async () => {
  mockStmt.first = (async () => ({ name: "users" } as never)) as any;
  let allCallCount = 0;
  mockStmt.all = (async () => {
    allCallCount++;
    if (allCallCount === 1) {
      return {
        results: [
          {
            cid: 0,
            name: "id",
            type: "INTEGER",
            notnull: 1,
            dflt_value: null,
            pk: 1,
          },
          {
            cid: 1,
            name: "name",
            type: "TEXT",
            notnull: 0,
            dflt_value: "'unnamed'",
            pk: 0,
          },
        ],
      } as never;
    }
    return {
      results: [
        {
          seq: 0,
          name: "idx_users_name",
          unique: 1,
          origin: "c",
          partial: 0,
        },
      ],
    } as never;
  }) as any;

  const result = await sqlDescribeHandler({ table: "users" }, makeContext());

  assertStringIncludes(result, "Table: users");
  assertStringIncludes(result, "id | INTEGER");
  assertStringIncludes(result, "name | TEXT");
  assertStringIncludes(result, "idx_users_name");
  assertStringIncludes(result, "UNIQUE");
});
// ---------------------------------------------------------------------------
// Object store tools
// ---------------------------------------------------------------------------

Deno.test("object store tool definitions - object_store_upload requires bucket, key, file_path", () => {
  assertEquals(OBJECT_STORE_UPLOAD.parameters.required, [
    "bucket",
    "key",
    "file_path",
  ]);
  assertEquals(OBJECT_STORE_UPLOAD.category, "storage");
});
Deno.test("object store tool definitions - object_store_list requires bucket", () => {
  assertEquals(OBJECT_STORE_LIST.parameters.required, ["bucket"]);
});
Deno.test("object store tool definitions - object_store_info requires bucket and key", () => {
  assertEquals(OBJECT_STORE_INFO.parameters.required, ["bucket", "key"]);
});

Deno.test("objectStoreListHandler - lists objects in a bucket", async () => {
  mockR2.list = (async () => ({
    objects: [
      { key: "file1.txt", size: 1024, uploaded: new Date("2026-01-01") },
      { key: "file2.txt", size: 2048, uploaded: new Date("2026-01-02") },
    ],
    truncated: false,
  })) as any;

  const result = await objectStoreListHandler(
    { bucket: "TENANT_SOURCE" },
    makeContext(),
  );

  assertStringIncludes(result, "file1.txt");
  assertStringIncludes(result, "file2.txt");
});
Deno.test("objectStoreListHandler - reports empty bucket", async () => {
  mockR2.list = (async () => ({ objects: [], truncated: false })) as any;

  const result = await objectStoreListHandler(
    { bucket: "TENANT_SOURCE" },
    makeContext(),
  );
  assertStringIncludes(result, "No objects found");
});
Deno.test("objectStoreListHandler - shows truncation notice", async () => {
  mockR2.list = (async () => ({
    objects: [{ key: "f.txt", size: 10, uploaded: new Date() }],
    truncated: true,
  })) as any;

  const result = await objectStoreListHandler(
    { bucket: "TENANT_SOURCE" },
    makeContext(),
  );
  assertStringIncludes(result, "More objects available");
});
Deno.test("objectStoreListHandler - throws for unknown bucket", async () => {
  await assertRejects(async () => {
    await objectStoreListHandler({ bucket: "UNKNOWN_BUCKET" }, makeContext());
  }, "Object store bucket not found");
});

Deno.test("objectStoreDeleteHandler - deletes an object", async () => {
  mockR2.delete = (async () => undefined) as any;

  const result = await objectStoreDeleteHandler(
    { bucket: "TENANT_SOURCE", key: "path/to/file.txt" },
    makeContext(),
  );
  assertStringIncludes(result, "Deleted");
});

Deno.test("objectStoreInfoHandler - returns object metadata", async () => {
  mockR2.head = (async () => ({
    size: 4096,
    uploaded: new Date("2026-01-01"),
    httpMetadata: { contentType: "text/plain" },
    etag: '"abc123"',
    customMetadata: { author: "user1" },
  })) as any;

  const result = await objectStoreInfoHandler(
    { bucket: "TENANT_SOURCE", key: "file.txt" },
    makeContext(),
  );

  assertStringIncludes(result, "4096 bytes");
  assertStringIncludes(result, "text/plain");
  assertStringIncludes(result, "author: user1");
});
Deno.test("objectStoreInfoHandler - throws when object not found", async () => {
  mockR2.head = (async () => null) as any;

  await assertRejects(async () => {
    await objectStoreInfoHandler(
      { bucket: "TENANT_SOURCE", key: "missing" },
      makeContext(),
    );
  }, "Object not found");
});
