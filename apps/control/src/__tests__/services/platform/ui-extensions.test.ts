import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database, R2Bucket } from '@takos/cloudflare-compat';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

import {
  listUIExtensions,
  getUIExtensionByPath,
  getUIExtensionBundle,
  getUISidebarItems,
  isUIExtensionPath,
  getUIExtensionPaths,
} from '@/services/platform/ui-extensions';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
  };
  return {
    select: vi.fn(() => chain),
    _: { get: getMock, all: allMock },
  };
}

const makeExtRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ext-1',
  accountId: 'ws-1',
  path: '/custom-panel',
  label: 'Custom Panel',
  icon: 'star',
  bundleR2Key: 'ui-ext/ws-1/ext-1.js',
  sidebarJson: JSON.stringify({ label: 'Panel', icon: 'star', path: '/custom-panel' }),
  bundleDeploymentId: 'bd-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('listUIExtensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no extensions', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listUIExtensions({} as D1Database, 'ws-1');
    expect(result).toEqual([]);
  });

  it('maps extension rows correctly', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([makeExtRow()]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listUIExtensions({} as D1Database, 'ws-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ext-1');
    expect(result[0].path).toBe('/custom-panel');
    expect(result[0].label).toBe('Custom Panel');
    expect(result[0].sidebar).toBeDefined();
    expect(result[0].sidebar!.label).toBe('Panel');
    expect(result[0].bundleDeploymentId).toBe('bd-1');
  });
});

describe('getUIExtensionByPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getUIExtensionByPath({} as D1Database, 'ws-1', '/nonexistent');
    expect(result).toBeNull();
  });

  it('returns extension when found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(makeExtRow());
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getUIExtensionByPath({} as D1Database, 'ws-1', '/custom-panel');
    expect(result).not.toBeNull();
    expect(result!.path).toBe('/custom-panel');
  });

  it('handles extension without sidebar JSON', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(makeExtRow({ sidebarJson: null }));
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getUIExtensionByPath({} as D1Database, 'ws-1', '/custom-panel');
    expect(result).not.toBeNull();
    expect(result!.sidebar).toBeUndefined();
  });
});

describe('getUIExtensionBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when extension not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const storage = {} as R2Bucket;
    const result = await getUIExtensionBundle({} as D1Database, storage, 'ws-1', '/nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when R2 object not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(makeExtRow());
    mocks.getDb.mockReturnValue(drizzle);

    const storage = {
      get: vi.fn().mockResolvedValue(null),
    } as unknown as R2Bucket;

    const result = await getUIExtensionBundle({} as D1Database, storage, 'ws-1', '/custom-panel');
    expect(result).toBeNull();
  });

  it('returns content and content type', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(makeExtRow());
    mocks.getDb.mockReturnValue(drizzle);

    const content = new ArrayBuffer(10);
    const storage = {
      get: vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(content),
        httpMetadata: { contentType: 'application/javascript' },
      }),
    } as unknown as R2Bucket;

    const result = await getUIExtensionBundle({} as D1Database, storage, 'ws-1', '/custom-panel');
    expect(result).not.toBeNull();
    expect(result!.contentType).toBe('application/javascript');
  });
});

describe('getUISidebarItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no sidebar extensions', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getUISidebarItems({} as D1Database, 'ws-1');
    expect(result).toEqual([]);
  });

  it('filters out invalid sidebar JSON', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([
      makeExtRow(),
      makeExtRow({ id: 'ext-2', sidebarJson: '{"invalid": true}' }),
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getUISidebarItems({} as D1Database, 'ws-1');
    // The first has valid sidebar, the second is missing label/icon
    expect(result).toHaveLength(1);
    expect(result[0].extensionId).toBe('ext-1');
  });
});

describe('isUIExtensionPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when extension exists at path', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ count: 1 });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await isUIExtensionPath({} as D1Database, 'ws-1', '/custom-panel');
    expect(result).toBe(true);
  });

  it('returns false when no extension at path', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ count: 0 });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await isUIExtensionPath({} as D1Database, 'ws-1', '/nonexistent');
    expect(result).toBe(false);
  });
});

describe('getUIExtensionPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all registered paths', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([{ path: '/panel-a' }, { path: '/panel-b' }]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getUIExtensionPaths({} as D1Database, 'ws-1');
    expect(result).toEqual(['/panel-a', '/panel-b']);
  });
});
