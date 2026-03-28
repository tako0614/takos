import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  isEmbeddingsAvailable: vi.fn().mockReturnValue(false),
  createEmbeddingsService: vi.fn().mockReturnValue(null),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/execution/embeddings', () => ({
  isEmbeddingsAvailable: mocks.isEmbeddingsAvailable,
  createEmbeddingsService: mocks.createEmbeddingsService,
}));

import { searchFilenames, searchContent, quickSearchPaths } from '@/services/source/search';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
  };
  return {
    select: vi.fn(() => chain),
    _: { get: getMock, all: allMock },
  };
}

describe('quickSearchPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns matching file paths', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([{ path: 'src/main.ts' }, { path: 'src/main.test.ts' }]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await quickSearchPaths({} as D1Database, 'ws-1', 'main');
    expect(result).toEqual(['src/main.ts', 'src/main.test.ts']);
  });

  it('returns empty array when no matches', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await quickSearchPaths({} as D1Database, 'ws-1', 'zzz');
    expect(result).toEqual([]);
  });
});

describe('searchFilenames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns file matches with scores', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([
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
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await searchFilenames({} as D1Database, 'ws-1', 'index');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('file');
    expect(result[0].file.path).toBe('src/index.ts');
    expect(result[0].score).toBeGreaterThan(0);
  });

  it('returns empty array when no matches', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await searchFilenames({} as D1Database, 'ws-1', 'nonexistent');
    expect(result).toEqual([]);
  });
});

describe('searchContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when storage is undefined', async () => {
    const result = await searchContent({} as D1Database, undefined, 'ws-1', 'hello');
    expect(result).toEqual([]);
  });

  it('finds content matches in text files', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([
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
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const bucket = {
      get: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue('Hello world\nThis is a test'),
      }),
    } as unknown as R2Bucket;

    const result = await searchContent({} as D1Database, bucket, 'ws-1', 'Hello');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('content');
    expect(result[0].matches).toBeDefined();
    expect(result[0].matches!.length).toBeGreaterThan(0);
    expect(result[0].matches![0].line).toBe(1);
  });

  it('skips large files', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([
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
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const bucket = { get: vi.fn() } as unknown as R2Bucket;

    const result = await searchContent({} as D1Database, bucket, 'ws-1', 'test');
    expect(result).toEqual([]);
    expect(bucket.get).not.toHaveBeenCalled();
  });
});
