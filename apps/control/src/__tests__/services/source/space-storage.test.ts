import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls } from "jsr:@std/testing/mock";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  validatePathSegment: () => true,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/path-validation'
import {
  bulkDeleteStorageItems,
  createFileRecord,
  createFolder,
  deleteR2Objects,
  deleteStorageItem,
  detectTextFromContent,
  escapeSqlLike,
  getStorageItem,
  getStorageItemByPath,
  listStorageFiles,
  moveStorageItem,
  renameStorageItem,
  StorageError,
} from "@/services/source/space-storage";

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
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
    orderBy: function (this: any) {
      return this;
    },
    limit: function (this: any) {
      return this;
    },
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock },
  };
}

Deno.test("escapeSqlLike - escapes percent sign", () => {
  assertEquals(escapeSqlLike("100%"), "100\\%");
});
Deno.test("escapeSqlLike - escapes underscore", () => {
  assertEquals(escapeSqlLike("my_file"), "my\\_file");
});
Deno.test("escapeSqlLike - escapes backslash", () => {
  assertEquals(escapeSqlLike("path\\to"), "path\\\\to");
});
Deno.test("escapeSqlLike - handles string with no special chars", () => {
  assertEquals(escapeSqlLike("hello"), "hello");
});

Deno.test("detectTextFromContent - returns true for text content", () => {
  const encoder = new TextEncoder();
  const buf = encoder.encode("Hello, world!").buffer as ArrayBuffer;
  assertEquals(detectTextFromContent(buf), true);
});
Deno.test("detectTextFromContent - returns false when null bytes present", () => {
  const buf = new Uint8Array([72, 101, 0, 108, 111]).buffer as ArrayBuffer;
  assertEquals(detectTextFromContent(buf), false);
});
Deno.test("detectTextFromContent - returns true for empty buffer", () => {
  const buf = new ArrayBuffer(0);
  assertEquals(detectTextFromContent(buf), true);
});

Deno.test("StorageError - has correct properties", () => {
  const err = new StorageError("Not found", "NOT_FOUND");
  assertEquals(err.message, "Not found");
  assertEquals(err.code, "NOT_FOUND");
  assertEquals(err.name, "StorageError");
});

Deno.test("listStorageFiles - returns empty when parent folder not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => undefined) as any; // parent lookup
  mocks.getDb = (() => drizzle) as any;

  const result = await listStorageFiles(
    {} as D1Database,
    "ws-1",
    "/nonexistent",
  );
  assertEquals(result.files, []);
  assertEquals(result.truncated, false);
});
Deno.test("listStorageFiles - lists root level files", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    {
      id: "f1",
      accountId: "ws-1",
      parentId: null,
      name: "readme.txt",
      path: "/readme.txt",
      type: "file",
      size: 100,
      mimeType: "text/plain",
      r2Key: "ws-storage/ws-1/f1",
      sha256: null,
      uploadedByAccountId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const result = await listStorageFiles({} as D1Database, "ws-1", "/");
  assertEquals(result.files.length, 1);
  assertEquals(result.files[0].name, "readme.txt");
});

Deno.test("getStorageItem - returns null when not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => undefined) as any;
  mocks.getDb = (() => drizzle) as any;

  const result = await getStorageItem({} as D1Database, "ws-1", "f1");
  assertEquals(result, null);
});
Deno.test("getStorageItem - returns mapped file when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({
    id: "f1",
    accountId: "ws-1",
    parentId: null,
    name: "test.txt",
    path: "/test.txt",
    type: "file",
    size: 42,
    mimeType: "text/plain",
    r2Key: "key",
    sha256: null,
    uploadedByAccountId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })) as any;
  mocks.getDb = (() => drizzle) as any;

  const result = await getStorageItem({} as D1Database, "ws-1", "f1");
  assertNotEquals(result, null);
  assertEquals(result!.id, "f1");
  assertEquals(result!.type, "file");
  assertEquals(result!.uploaded_by, "user-1");
});

Deno.test("createFolder - throws StorageError for invalid folder name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.validatePathSegment = (() => false) as any;
  const drizzle = createDrizzleMock();
  mocks.getDb = (() => drizzle) as any;

  await assertRejects(async () => {
    await createFolder({} as D1Database, "ws-1", "user-1", { name: "../bad" });
  }, StorageError);
});

Deno.test("deleteR2Objects - deletes objects in batches", async () => {
  const deleteFn = async () => undefined;
  const bucket = { delete: deleteFn } as unknown as R2Bucket;

  const keys = Array.from({ length: 5 }, (_, i) => `key-${i}`);
  await deleteR2Objects(bucket, keys);

  assertSpyCalls(deleteFn, 1);
  assertSpyCallArgs(deleteFn, 0, [keys]);
});

Deno.test("bulkDeleteStorageItems - returns count and failed ids", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  // First item found and deleted
  drizzle._.get =
    (async () => ({
      id: "f1",
      accountId: "ws-1",
      parentId: null,
      name: "test.txt",
      path: "/test.txt",
      type: "file",
      size: 42,
      mimeType: null,
      r2Key: "key1",
      sha256: null,
      uploadedByAccountId: null,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    })) as any =
      (async () => ({ r2Key: "key1" })) as any;
  mocks.getDb = (() => drizzle) as any;

  // Only test with one item since the mock state is complex
  const result = await bulkDeleteStorageItems({} as D1Database, "ws-1", ["f1"]);
  assertEquals(result.deletedCount, 1);
  assertEquals(result.failedIds, []);
});
