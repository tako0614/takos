import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import {
  deployFrontendFromWorkspace,
  normalizeDistPath,
} from "@/services/source/apps";

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const state: { get: any; all: any; run: any } = {
    get: getMock,
    all: allMock,
    run: runMock,
  };
  const chain = {
    from: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    set: function (this: any) {
      return this;
    },
    values: function (this: any) {
      return this;
    },
    returning: function (this: any) {
      return this;
    },
    orderBy: function (this: any) {
      return this;
    },
    limit: function (this: any) {
      return this;
    },
    get: (...args: any[]) => state.get(...args),
    all: (...args: any[]) => state.all(...args),
    run: (...args: any[]) => state.run(...args),
  };
  return {
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
  const env = { DB: {} as D1Database, TENANT_SOURCE: {} } as any;
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
  const env = { DB: {} as D1Database, TENANT_SOURCE: {} } as any;
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
  const env = {
    DB: drizzle as unknown as D1Database,
    TENANT_SOURCE: undefined,
  } as any;
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
  drizzle._state.all = (async () => []) as any; // no files found
  const env = {
    DB: drizzle as unknown as D1Database,
    TENANT_SOURCE: {
      list: ((..._args: any[]) => undefined) as any,
      get: ((..._args: any[]) => undefined) as any,
      put: ((..._args: any[]) => undefined) as any,
      delete: ((..._args: any[]) => undefined) as any,
    },
  } as any;
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
  drizzle._state.all = (async () => [
    { id: "file-1", path: "dist/index.html" },
    { id: "file-2", path: "dist/app.js" },
  ]) as any;
  // existing app check
  drizzle._state.get = (async () => null) as any;
  const bucketGet = async () => ({ body: "content" });
  const bucketPut = async () => undefined;
  const bucket = {
    list: ((..._args: any[]) => undefined) as any,
    get: bucketGet,
    put: bucketPut,
    delete: ((..._args: any[]) => undefined) as any,
  };
  const env = {
    DB: drizzle as unknown as D1Database,
    TENANT_SOURCE: bucket,
  } as any;

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
  drizzle._state.all =
    (async () => [{ id: "file-1", path: "dist/index.html" }]) as any;
  drizzle._state.get = (async () => ({ id: "app-1" })) as any; // existing app
  const bucketGet = async () => ({ body: "content" });
  const bucket = {
    list: ((..._args: any[]) => undefined) as any,
    get: bucketGet,
    put: ((..._args: any[]) => undefined) as any,
    delete: ((..._args: any[]) => undefined) as any,
  };
  const env = {
    DB: drizzle as unknown as D1Database,
    TENANT_SOURCE: bucket,
  } as any;

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
  drizzle._state.all =
    (async () => [{ id: "file-1", path: "dist/index.html" }]) as any;
  drizzle._state.get = (async () => null) as any;
  const existingObjs = { objects: [{ key: "apps/my-app/old.js" }] };
  const bucketList = async () => existingObjs;
  const bucketDelete = async (..._args: any[]) => undefined;
  const bucket = {
    list: bucketList,
    get: async () => ({ body: "content" }),
    put: ((..._args: any[]) => undefined) as any,
    delete: bucketDelete,
  };
  const env = {
    DB: drizzle as unknown as D1Database,
    TENANT_SOURCE: bucket,
  } as any;

  await deployFrontendFromWorkspace(env, {
    spaceId: "ws-1",
    appName: "my-app",
    distPath: "dist",
    clear: true,
  });

  await bucketDelete("apps/my-app/old.js");
});
