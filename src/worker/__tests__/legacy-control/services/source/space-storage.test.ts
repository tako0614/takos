// deno-lint-ignore-file no-import-prefix no-unversioned-import require-await
import type { ObjectStoreBinding } from "@/shared/types/bindings.ts";

import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";

import {
  bulkDeleteStorageItems,
  createFolder,
  deleteR2Objects,
  detectTextFromContent,
  escapeSqlLike,
  getStorageItem,
  listStorageFiles,
  StorageError,
} from "@/services/source/space-storage";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";
import { asTestDatabase } from "@test/db-stubs";

type FakeStep = {
  get?: unknown;
  all?: unknown[];
  run?: unknown;
};

function createFakeSqlDatabaseBinding(steps: FakeStep[]) {
  let index = 0;
  const next = () => steps[index++] ?? {};
  const buildChain = () => {
    const step = next();
    const chain: any = {
      from() {
        return chain;
      },
      where() {
        return chain;
      },
      innerJoin() {
        return chain;
      },
      leftJoin() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return chain;
      },
      offset() {
        return chain;
      },
      values() {
        return chain;
      },
      set() {
        return chain;
      },
      returning() {
        return chain;
      },
      get: async () => step.get ?? null,
      first: async () => step.get ?? null,
      all: async () => step.all ?? [],
      run: async () =>
        step.run ?? {
          success: true,
          meta: { changes: 0, last_row_id: 0, duration: 0 },
        },
      raw: async () => step.all ?? [],
    };
    return chain;
  };
  return asTestDatabase({
    select() {
      return buildChain();
    },
    insert() {
      return buildChain();
    },
    update() {
      return buildChain();
    },
    delete() {
      return buildChain();
    },
  });
}

function createBucketMock(): ObjectStoreBinding & { deleteCalls: string[][] } {
  const deleteCalls: string[][] = [];
  return {
    delete: (keys: string | string[]) => {
      deleteCalls.push(Array.isArray(keys) ? keys : [keys]);
      return Promise.resolve();
    },
    get: () => Promise.resolve(null),
    put: () => Promise.resolve(null),
    head: () => Promise.resolve(null),
    list: () =>
      Promise.resolve({
        objects: [],
        truncated: false,
        delimitedPrefixes: [],
      }),
    deleteCalls,
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
  const db = createFakeSqlDatabaseBinding([{ get: undefined }]);
  const result = await listStorageFiles(db, "ws-1", "/nonexistent");
  assertEquals(result.files, []);
  assertEquals(result.truncated, false);
});

Deno.test("listStorageFiles - lists root level files", async () => {
  const db = createFakeSqlDatabaseBinding([
    {
      all: [{
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
      }],
    },
  ]);

  const result = await listStorageFiles(db, "ws-1", "/");
  assertEquals(result.files.length, 1);
  assertEquals(result.files[0].name, "readme.txt");
});

Deno.test("getStorageItem - returns null when not found", async () => {
  const db = createFakeSqlDatabaseBinding([{ get: undefined }]);
  const result = await getStorageItem(db, "ws-1", "f1");
  assertEquals(result, null);
});

Deno.test("getStorageItem - returns mapped file when found", async () => {
  const db = createFakeSqlDatabaseBinding([
    {
      get: {
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
      },
    },
  ]);

  const result = await getStorageItem(db, "ws-1", "f1");
  assertNotEquals(result, null);
  assertEquals(result!.id, "f1");
  assertEquals(result!.type, "file");
  assertEquals(result!.uploaded_by, "user-1");
});

Deno.test("createFolder - throws StorageError for invalid folder name", async () => {
  await assertRejects(
    () =>
      createFolder(noopSqlDatabaseBinding(), "ws-1", "user-1", {
        name: "../bad",
      }),
    StorageError,
  );
});

Deno.test("object store delete helper - deletes objects in batches", async () => {
  const bucket = createBucketMock();

  const keys = Array.from({ length: 5 }, (_, i) => `key-${i}`);
  await deleteR2Objects(bucket, keys);

  assertEquals(bucket.deleteCalls.length, 1);
  assertEquals(bucket.deleteCalls[0], keys);
});

Deno.test("bulkDeleteStorageItems - returns count and failed ids", async () => {
  const db = createFakeSqlDatabaseBinding([
    {
      get: {
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
      },
    },
    { get: { r2Key: "key1" } },
  ]);

  const result = await bulkDeleteStorageItems(db, "ws-1", ["f1"]);
  assertEquals(result.deletedCount, 1);
  assertEquals(result.failedIds, []);
});
