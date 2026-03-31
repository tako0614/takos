import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

import { assertEquals, assert } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  isEmbeddingsAvailable: (() => false),
  createEmbeddingsService: (() => null),
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/embeddings'
import { searchFilenames, searchContent, quickSearchPaths } from '@/services/source/search';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
  };
  return {
    select: () => chain,
    _: { get: getMock, all: allMock },
  };
}


  Deno.test('quickSearchPaths - returns matching file paths', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [{ path: 'src/main.ts' }, { path: 'src/main.test.ts' }]) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await quickSearchPaths({} as D1Database, 'ws-1', 'main');
    assertEquals(result, ['src/main.ts', 'src/main.test.ts']);
})
  Deno.test('quickSearchPaths - returns empty array when no matches', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await quickSearchPaths({} as D1Database, 'ws-1', 'zzz');
    assertEquals(result, []);
})

  Deno.test('searchFilenames - returns file matches with scores', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
      {
        id: 'f1',
        accountId: 'ws-1',
        path: 'src/index.ts',
        kind: 'source',
        mimeType: 'text/typescript',
        size: 100,
        sha256: 'abc',
        origin: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await searchFilenames({} as D1Database, 'ws-1', 'index');

    assertEquals(result.length, 1);
    assertEquals(result[0].type, 'file');
    assertEquals(result[0].file.path, 'src/index.ts');
    assert(result[0].score > 0);
})
  Deno.test('searchFilenames - returns empty array when no matches', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await searchFilenames({} as D1Database, 'ws-1', 'nonexistent');
    assertEquals(result, []);
})

  Deno.test('searchContent - returns empty when storage is undefined', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await searchContent({} as D1Database, undefined, 'ws-1', 'hello');
    assertEquals(result, []);
})
  Deno.test('searchContent - finds content matches in text files', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
      {
        id: 'f1',
        accountId: 'ws-1',
        path: 'readme.md',
        kind: 'doc',
        mimeType: 'text/markdown',
        size: 100,
        sha256: 'abc',
        origin: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const bucket = {
      get: (async () => ({
        text: (async () => 'Hello world\nThis is a test'),
      })),
    } as unknown as R2Bucket;

    const result = await searchContent({} as D1Database, bucket, 'ws-1', 'Hello');

    assertEquals(result.length, 1);
    assertEquals(result[0].type, 'content');
    assert(result[0].matches !== undefined);
    assert(result[0].matches!.length > 0);
    assertEquals(result[0].matches![0].line, 1);
})
  Deno.test('searchContent - skips large files', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
      {
        id: 'f1',
        accountId: 'ws-1',
        path: 'big.bin',
        kind: 'source',
        mimeType: null,
        size: 2 * 1024 * 1024, // 2MB
        sha256: null,
        origin: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const bucket = { get: ((..._args: any[]) => undefined) as any } as unknown as R2Bucket;

    const result = await searchContent({} as D1Database, bucket, 'ws-1', 'test');
    assertEquals(result, []);
    assertSpyCalls(bucket.get, 0);
})