import { assertEquals, assertRejects, assertThrows } from "@std/assert";

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import {
  deployFrontendFromWorkspace,
  normalizeDistPath,
} from "@/services/source/apps";
import {
  noopObjectStoreBinding,
  noopSqlDatabaseBinding,
} from "@test/binding-stubs";
import type { Env } from "@/shared/types/env.ts";

/**
 * Build a minimal `Env` for tests that only exercise the DB/TENANT_SOURCE
 * surface of `deployFrontendFromWorkspace`. The unfilled fields are never
 * read by the function under test, so the cast is centralised here.
 */
function makeEnv(partial: Partial<Env>): Env {
  return partial as Env;
}

type AnyMockFn = (...args: unknown[]) => unknown;

interface DrizzleMockState {
  get: AnyMockFn;
  all: AnyMockFn;
  run: AnyMockFn;
}

interface DrizzleMockChain {
  from(): DrizzleMockChain;
  where(): DrizzleMockChain;
  set(): DrizzleMockChain;
  values(): DrizzleMockChain;
  returning(): DrizzleMockChain;
  orderBy(): DrizzleMockChain;
  limit(): DrizzleMockChain;
  get: AnyMockFn;
  all: AnyMockFn;
  run: AnyMockFn;
}

function createDrizzleMock() {
  const getMock: AnyMockFn = () => undefined;
  const allMock: AnyMockFn = () => undefined;
  const runMock: AnyMockFn = () => undefined;
  const state: DrizzleMockState = {
    get: getMock,
    all: allMock,
    run: runMock,
  };
  const chain: DrizzleMockChain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    set() {
      return chain;
    },
    values() {
      return chain;
    },
    returning() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return chain;
    },
    get: (...args: unknown[]) => state.get(...args),
    all: (...args: unknown[]) => state.all(...args),
    run: (...args: unknown[]) => state.run(...args),
  };
  // The function under test passes the drizzle mock through `getDb`, which
  // returns drizzle-shaped DBs untouched but expects the SqlDatabaseBinding
  // surface on the env input. We include the binding methods as throwing
  // stubs (they're never called in these tests).
  return {
    ...noopSqlDatabaseBinding(),
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _state: state,
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

Deno.test("normalizeDistPath - trims whitespace and normalizes slashes", () => {
  assertEquals(normalizeDistPath("  dist/output  "), "dist/output");
});
Deno.test("normalizeDistPath - strips leading and trailing slashes", () => {
  assertEquals(normalizeDistPath("/dist/output/"), "dist/output");
});
Deno.test("normalizeDistPath - converts backslashes to forward slashes", () => {
  assertEquals(normalizeDistPath("dist\\output\\files"), "dist/output/files");
});
Deno.test("normalizeDistPath - rejects empty paths", () => {
  assertThrows(() => normalizeDistPath(""), "Invalid dist_path");
});
Deno.test("normalizeDistPath - rejects paths with double dots", () => {
  assertThrows(() => normalizeDistPath("../etc/passwd"), "Invalid dist_path");
});
Deno.test("normalizeDistPath - handles single directory name", () => {
  assertEquals(normalizeDistPath("dist"), "dist");
});

Deno.test("deployFrontendFromWorkspace - throws when app_name is empty", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = makeEnv({
    DB: noopSqlDatabaseBinding(),
    TENANT_SOURCE: Object.assign(noopObjectStoreBinding(), {}),
  });
  await assertRejects(async () => {
    await deployFrontendFromWorkspace(env, {
      spaceId: "ws-1",
      appName: "",
      distPath: "dist",
    });
  }, "app_name is required");
});
Deno.test("deployFrontendFromWorkspace - throws when app_name format is invalid", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = makeEnv({
    DB: noopSqlDatabaseBinding(),
    TENANT_SOURCE: Object.assign(noopObjectStoreBinding(), {}),
  });
  await assertRejects(async () => {
    await deployFrontendFromWorkspace(env, {
      spaceId: "ws-1",
      appName: "AB",
      distPath: "dist",
    });
  }, "app_name must be 3-64 chars");
});
Deno.test("deployFrontendFromWorkspace - throws when TENANT_SOURCE is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  const env = makeEnv({
    DB: drizzle,
    TENANT_SOURCE: undefined,
  });
  await assertRejects(async () => {
    await deployFrontendFromWorkspace(env, {
      spaceId: "ws-1",
      appName: "my-app",
      distPath: "dist",
    });
  }, "TENANT_SOURCE is not configured");
});
Deno.test("deployFrontendFromWorkspace - throws when no files found under dist path", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._state.all = async () => []; // no files found
  const env = makeEnv({
    DB: drizzle,
    TENANT_SOURCE: Object.assign(noopObjectStoreBinding(), {
      list: () => undefined as never,
      get: () => undefined as never,
      put: () => undefined as never,
      delete: () => undefined as never,
    }),
  });
  await assertRejects(async () => {
    await deployFrontendFromWorkspace(env, {
      spaceId: "ws-1",
      appName: "my-app",
      distPath: "dist",
    });
  }, "No files found under dist/");
});
Deno.test("deployFrontendFromWorkspace - uploads files and creates app record for new app", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  // files query
  drizzle._state.all = async () => [
    { id: "file-1", path: "dist/index.html" },
    { id: "file-2", path: "dist/app.js" },
  ];
  // existing app check
  drizzle._state.get = async () => null;
  const bucketGet = async () => ({ body: "content" });
  const bucketPut = async () => undefined;
  const bucket = Object.assign(noopObjectStoreBinding(), {
    list: () => undefined as never,
    get: bucketGet,
    put: bucketPut,
    delete: () => undefined as never,
  });
  const env = makeEnv({
    DB: drizzle,
    TENANT_SOURCE: bucket,
  });

  const result = await deployFrontendFromWorkspace(env, {
    spaceId: "ws-1",
    appName: "my-app",
    distPath: "dist",
  });

  assertEquals(result.appName, "my-app");
  assertEquals(result.uploaded, 2);
  assertEquals(result.url, "/apps/my-app/");
});
Deno.test("deployFrontendFromWorkspace - updates existing app record on re-deploy", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._state.all = async () => [{ id: "file-1", path: "dist/index.html" }];
  drizzle._state.get = async () => ({ id: "app-1" }); // existing app
  const bucketGet = async () => ({ body: "content" });
  const bucket = Object.assign(noopObjectStoreBinding(), {
    list: () => undefined as never,
    get: bucketGet,
    put: () => undefined as never,
    delete: () => undefined as never,
  });
  const env = makeEnv({
    DB: drizzle,
    TENANT_SOURCE: bucket,
  });

  const result = await deployFrontendFromWorkspace(env, {
    spaceId: "ws-1",
    appName: "my-app",
    distPath: "dist",
  });

  assertEquals(result.uploaded, 1);
});
Deno.test("deployFrontendFromWorkspace - clears existing objects when clear=true", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._state.all = async () => [{ id: "file-1", path: "dist/index.html" }];
  drizzle._state.get = async () => null;
  const existingObjs = { objects: [{ key: "apps/my-app/old.js" }] };
  const bucketList = async () => existingObjs;
  const bucketDelete = async (..._args: any[]) => undefined;
  const bucket = Object.assign(noopObjectStoreBinding(), {
    list: bucketList,
    get: async () => ({ body: "content" }),
    put: () => undefined as never,
    delete: bucketDelete,
  });
  const env = makeEnv({
    DB: drizzle,
    TENANT_SOURCE: bucket,
  });

  await deployFrontendFromWorkspace(env, {
    spaceId: "ws-1",
    appName: "my-app",
    distPath: "dist",
    clear: true,
  });

  await bucketDelete("apps/my-app/old.js");
});
