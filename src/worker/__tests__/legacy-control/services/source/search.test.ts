import type { ObjectStoreBinding } from "@/shared/types/bindings.ts";

import { assert, assertEquals } from "@std/assert";

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/embeddings'
import {
  quickSearchPaths,
  searchContent,
  searchFilenames,
} from "@/services/source/search";
import {
  noopObjectStoreBinding,
  noopSqlDatabaseBinding,
} from "@test/binding-stubs";
import { asTestDatabase } from "@test/db-stubs";
import { makeObjectStoreObjectBody } from "../../../../test/integration/setup.ts";

type MockFn = (...args: unknown[]) => unknown;

interface DrizzleMockState {
  get: MockFn;
  all: MockFn;
}

interface DrizzleMockChain {
  from(): DrizzleMockChain;
  where(): DrizzleMockChain;
  orderBy(): DrizzleMockChain;
  limit(): DrizzleMockChain;
  get: MockFn;
  all: MockFn;
}

function createDrizzleMock() {
  const getMock: MockFn = () => undefined;
  const allMock: MockFn = () => undefined;
  const state: DrizzleMockState = {
    get: getMock,
    all: allMock,
  };
  const chain: DrizzleMockChain = {
    from() {
      return chain;
    },
    where() {
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
  };
  return asTestDatabase({
    select: () => chain,
    _state: state,
    _: { get: getMock, all: allMock },
  });
}

Deno.test("quickSearchPaths - returns matching file paths", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._state.all = async () => [{ path: "src/main.ts" }, {
    path: "src/main.test.ts",
  }];
  const result = await quickSearchPaths(
    drizzle,
    "ws-1",
    "main",
  );
  assertEquals(result, ["src/main.ts", "src/main.test.ts"]);
});
Deno.test("quickSearchPaths - returns empty array when no matches", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._state.all = async () => [];
  const result = await quickSearchPaths(
    drizzle,
    "ws-1",
    "zzz",
  );
  assertEquals(result, []);
});

Deno.test("searchFilenames - returns file matches with scores", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._state.all = async () => [
    {
      id: "f1",
      accountId: "ws-1",
      path: "src/index.ts",
      kind: "source",
      mimeType: "text/typescript",
      size: 100,
      sha256: "abc",
      origin: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const result = await searchFilenames(
    drizzle,
    "ws-1",
    "index",
  );

  assertEquals(result.length, 1);
  const first = result[0];
  assert(first !== undefined);
  assertEquals(first.type, "file");
  assertEquals(first.file.path, "src/index.ts");
  assert(first.score !== undefined);
  assert(first.score > 0);
});
Deno.test("searchFilenames - returns empty array when no matches", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._state.all = async () => [];
  const result = await searchFilenames(
    drizzle,
    "ws-1",
    "nonexistent",
  );
  assertEquals(result, []);
});

Deno.test("searchContent - returns empty when storage is undefined", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await searchContent(
    noopSqlDatabaseBinding(),
    undefined,
    "ws-1",
    "hello",
  );
  assertEquals(result, []);
});
Deno.test("searchContent - finds content matches in text files", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._state.all = async () => [
    {
      id: "f1",
      accountId: "ws-1",
      path: "readme.md",
      kind: "doc",
      mimeType: "text/markdown",
      size: 100,
      sha256: "abc",
      origin: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const bucket: ObjectStoreBinding = {
    ...noopObjectStoreBinding(),
    get: () =>
      Promise.resolve(makeObjectStoreObjectBody("Hello world\nThis is a test")),
  };

  const result = await searchContent(
    drizzle,
    bucket,
    "ws-1",
    "Hello",
  );

  assertEquals(result.length, 1);
  assertEquals(result[0].type, "content");
  assert(result[0].matches !== undefined);
  assert(result[0].matches!.length > 0);
  assertEquals(result[0].matches![0].line, 1);
});
Deno.test("searchContent - skips large files", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._state.all = async () => [
    {
      id: "f1",
      accountId: "ws-1",
      path: "big.bin",
      kind: "source",
      mimeType: null,
      size: 2 * 1024 * 1024, // 2MB
      sha256: null,
      origin: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const bucket: ObjectStoreBinding = noopObjectStoreBinding();

  const result = await searchContent(
    drizzle,
    bucket,
    "ws-1",
    "test",
  );
  assertEquals(result, []);
});
