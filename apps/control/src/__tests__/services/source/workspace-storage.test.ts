import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database, R2Bucket } from '@takos/cloudflare-compat';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  validatePathSegment: vi.fn().mockReturnValue(true),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils/path-validation', () => ({
  validatePathSegment: mocks.validatePathSegment,
}));

import {
  escapeSqlLike,
  detectTextFromContent,
  StorageError,
  listStorageFiles,
  getStorageItem,
  getStorageItemByPath,
  createFolder,
  createFileRecord,
  deleteStorageItem,
  renameStorageItem,
  moveStorageItem,
  bulkDeleteStorageItems,
  deleteR2Objects,
} from '@/services/source/workspace-storage';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock },
  };
}

describe('escapeSqlLike', () => {
  it('escapes percent sign', () => {
    expect(escapeSqlLike('100%')).toBe('100\\%');
  });

  it('escapes underscore', () => {
    expect(escapeSqlLike('my_file')).toBe('my\\_file');
  });

  it('escapes backslash', () => {
    expect(escapeSqlLike('path\\to')).toBe('path\\\\to');
  });

  it('handles string with no special chars', () => {
    expect(escapeSqlLike('hello')).toBe('hello');
  });
});

describe('detectTextFromContent', () => {
  it('returns true for text content', () => {
    const encoder = new TextEncoder();
    const buf = encoder.encode('Hello, world!').buffer as ArrayBuffer;
    expect(detectTextFromContent(buf)).toBe(true);
  });

  it('returns false when null bytes present', () => {
    const buf = new Uint8Array([72, 101, 0, 108, 111]).buffer as ArrayBuffer;
    expect(detectTextFromContent(buf)).toBe(false);
  });

  it('returns true for empty buffer', () => {
    const buf = new ArrayBuffer(0);
    expect(detectTextFromContent(buf)).toBe(true);
  });
});

describe('StorageError', () => {
  it('has correct properties', () => {
    const err = new StorageError('Not found', 'NOT_FOUND');
    expect(err.message).toBe('Not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.name).toBe('StorageError');
  });
});

describe('listStorageFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when parent folder not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined); // parent lookup
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listStorageFiles({} as D1Database, 'ws-1', '/nonexistent');
    expect(result.files).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('lists root level files', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([
      {
        id: 'f1',
        accountId: 'ws-1',
        parentId: null,
        name: 'readme.txt',
        path: '/readme.txt',
        type: 'file',
        size: 100,
        mimeType: 'text/plain',
        r2Key: 'ws-storage/ws-1/f1',
        sha256: null,
        uploadedByAccountId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listStorageFiles({} as D1Database, 'ws-1', '/');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('readme.txt');
  });
});

describe('getStorageItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getStorageItem({} as D1Database, 'ws-1', 'f1');
    expect(result).toBeNull();
  });

  it('returns mapped file when found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({
      id: 'f1',
      accountId: 'ws-1',
      parentId: null,
      name: 'test.txt',
      path: '/test.txt',
      type: 'file',
      size: 42,
      mimeType: 'text/plain',
      r2Key: 'key',
      sha256: null,
      uploadedByAccountId: 'user-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getStorageItem({} as D1Database, 'ws-1', 'f1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('f1');
    expect(result!.type).toBe('file');
    expect(result!.uploaded_by).toBe('user-1');
  });
});

describe('createFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws StorageError for invalid folder name', async () => {
    mocks.validatePathSegment.mockReturnValueOnce(false);
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    await expect(
      createFolder({} as D1Database, 'ws-1', 'user-1', { name: '../bad' }),
    ).rejects.toThrow(StorageError);
  });
});

describe('deleteR2Objects', () => {
  it('deletes objects in batches', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const bucket = { delete: deleteFn } as unknown as R2Bucket;

    const keys = Array.from({ length: 5 }, (_, i) => `key-${i}`);
    await deleteR2Objects(bucket, keys);

    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(deleteFn).toHaveBeenCalledWith(keys);
  });
});

describe('bulkDeleteStorageItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns count and failed ids', async () => {
    const drizzle = createDrizzleMock();
    // First item found and deleted
    drizzle._.get
      .mockResolvedValueOnce({
        id: 'f1',
        accountId: 'ws-1',
        parentId: null,
        name: 'test.txt',
        path: '/test.txt',
        type: 'file',
        size: 42,
        mimeType: null,
        r2Key: 'key1',
        sha256: null,
        uploadedByAccountId: null,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      })
      .mockResolvedValueOnce({ r2Key: 'key1' });
    mocks.getDb.mockReturnValue(drizzle);

    // Only test with one item since the mock state is complex
    const result = await bulkDeleteStorageItems({} as D1Database, 'ws-1', ['f1']);
    expect(result.deletedCount).toBe(1);
    expect(result.failedIds).toEqual([]);
  });
});
