import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn().mockReturnValue('gen-id-1'),
  now: vi.fn().mockReturnValue('2026-03-24T00:00:00.000Z'),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils')>()),
  generateId: mocks.generateId,
  now: mocks.now,
}));

import { normalizeDistPath, deployFrontendFromWorkspace } from '@/services/source/apps';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
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
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

describe('normalizeDistPath', () => {
  it('trims whitespace and normalizes slashes', () => {
    expect(normalizeDistPath('  dist/output  ')).toBe('dist/output');
  });

  it('strips leading and trailing slashes', () => {
    expect(normalizeDistPath('/dist/output/')).toBe('dist/output');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizeDistPath('dist\\output\\files')).toBe('dist/output/files');
  });

  it('rejects empty paths', () => {
    expect(() => normalizeDistPath('')).toThrow('Invalid dist_path');
  });

  it('rejects paths with double dots', () => {
    expect(() => normalizeDistPath('../etc/passwd')).toThrow('Invalid dist_path');
  });

  it('handles single directory name', () => {
    expect(normalizeDistPath('dist')).toBe('dist');
  });
});

describe('deployFrontendFromWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when app_name is empty', async () => {
    const env = { DB: {} as D1Database, TENANT_SOURCE: {} } as any;
    await expect(
      deployFrontendFromWorkspace(env, { spaceId: 'ws-1', appName: '', distPath: 'dist' }),
    ).rejects.toThrow('app_name is required');
  });

  it('throws when app_name format is invalid', async () => {
    const env = { DB: {} as D1Database, TENANT_SOURCE: {} } as any;
    await expect(
      deployFrontendFromWorkspace(env, { spaceId: 'ws-1', appName: 'AB', distPath: 'dist' }),
    ).rejects.toThrow('app_name must be 3-64 chars');
  });

  it('throws when TENANT_SOURCE is not configured', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);
    const env = { DB: {} as D1Database, TENANT_SOURCE: undefined } as any;
    await expect(
      deployFrontendFromWorkspace(env, { spaceId: 'ws-1', appName: 'my-app', distPath: 'dist' }),
    ).rejects.toThrow('TENANT_SOURCE is not configured');
  });

  it('throws when no files found under dist path', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]); // no files found
    mocks.getDb.mockReturnValue(drizzle);
    const env = {
      DB: {} as D1Database,
      TENANT_SOURCE: { list: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    } as any;
    await expect(
      deployFrontendFromWorkspace(env, { spaceId: 'ws-1', appName: 'my-app', distPath: 'dist' }),
    ).rejects.toThrow('No files found under dist/');
  });

  it('uploads files and creates app record for new app', async () => {
    const drizzle = createDrizzleMock();
    // files query
    drizzle._.all.mockResolvedValueOnce([
      { id: 'file-1', path: 'dist/index.html' },
      { id: 'file-2', path: 'dist/app.js' },
    ]);
    // existing app check
    drizzle._.get.mockResolvedValueOnce(null);
    mocks.getDb.mockReturnValue(drizzle);

    const bucketGet = vi.fn().mockResolvedValue({ body: 'content' });
    const bucketPut = vi.fn().mockResolvedValue(undefined);
    const bucket = { list: vi.fn(), get: bucketGet, put: bucketPut, delete: vi.fn() };
    const env = { DB: {} as D1Database, TENANT_SOURCE: bucket } as any;

    const result = await deployFrontendFromWorkspace(env, {
      spaceId: 'ws-1',
      appName: 'my-app',
      distPath: 'dist',
    });

    expect(result.appName).toBe('my-app');
    expect(result.uploaded).toBe(2);
    expect(result.url).toBe('/apps/my-app/');
    expect(drizzle.insert).toHaveBeenCalled();
  });

  it('updates existing app record on re-deploy', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([{ id: 'file-1', path: 'dist/index.html' }]);
    drizzle._.get.mockResolvedValueOnce({ id: 'app-1' }); // existing app
    mocks.getDb.mockReturnValue(drizzle);

    const bucketGet = vi.fn().mockResolvedValue({ body: 'content' });
    const bucket = { list: vi.fn(), get: bucketGet, put: vi.fn(), delete: vi.fn() };
    const env = { DB: {} as D1Database, TENANT_SOURCE: bucket } as any;

    const result = await deployFrontendFromWorkspace(env, {
      spaceId: 'ws-1',
      appName: 'my-app',
      distPath: 'dist',
    });

    expect(result.uploaded).toBe(1);
    expect(drizzle.update).toHaveBeenCalled();
  });

  it('clears existing objects when clear=true', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([{ id: 'file-1', path: 'dist/index.html' }]);
    drizzle._.get.mockResolvedValueOnce(null);
    mocks.getDb.mockReturnValue(drizzle);

    const existingObjs = { objects: [{ key: 'apps/my-app/old.js' }] };
    const bucketList = vi.fn().mockResolvedValue(existingObjs);
    const bucketDelete = vi.fn().mockResolvedValue(undefined);
    const bucket = {
      list: bucketList,
      get: vi.fn().mockResolvedValue({ body: 'content' }),
      put: vi.fn(),
      delete: bucketDelete,
    };
    const env = { DB: {} as D1Database, TENANT_SOURCE: bucket } as any;

    await deployFrontendFromWorkspace(env, {
      spaceId: 'ws-1',
      appName: 'my-app',
      distPath: 'dist',
      clear: true,
    });

    expect(bucketDelete).toHaveBeenCalledWith(['apps/my-app/old.js']);
  });
});
