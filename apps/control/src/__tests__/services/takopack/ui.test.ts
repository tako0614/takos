import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  nanoid: vi.fn().mockReturnValue('ui-ext-id'),
  getRequiredPackageFile: vi.fn(),
  normalizePackagePath: vi.fn((p: string) => p.replace(/^\.?\//, '')),
  getAssetContentType: vi.fn().mockReturnValue('application/octet-stream'),
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
}));

vi.mock('nanoid', () => ({
  nanoid: mocks.nanoid,
}));

vi.mock('@/services/takopack/manifest', () => ({
  getRequiredPackageFile: mocks.getRequiredPackageFile,
  normalizePackagePath: mocks.normalizePackagePath,
  getAssetContentType: mocks.getAssetContentType,
}));

import { BundleUIService, getUIAssetR2Key } from '@/services/takopack/ui';

function createMockDb() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function createMockR2() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
  };
}

describe('getUIAssetR2Key', () => {
  it('constructs the correct R2 key', () => {
    const key = getUIAssetR2Key('ws-1', 'tp-1', 'assets/style.css');
    expect(key).toBe('ui-extensions/ws-1/tp-1/assets/assets/style.css');
  });

  it('constructs R2 key with nested paths', () => {
    const key = getUIAssetR2Key('ws-1', 'tp-1', 'dist/js/app.js');
    expect(key).toBe('ui-extensions/ws-1/tp-1/assets/dist/js/app.js');
  });
});

describe('BundleUIService', () => {
  let dbMock: ReturnType<typeof createMockDb>;
  let r2Mock: ReturnType<typeof createMockR2>;

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock = createMockDb();
    r2Mock = createMockR2();
    mocks.getDb.mockReturnValue(dbMock);
    mocks.getRequiredPackageFile.mockReturnValue(new ArrayBuffer(10));
  });

  describe('registerUIExtension', () => {
    it('registers a UI extension with R2 upload and DB insert', async () => {
      const service = new BundleUIService({
        DB: {},
        UI_BUNDLES: r2Mock,
      } as any);

      const result = await service.registerUIExtension(
        'ws-1',
        'tp-1',
        { path: '/dashboard', label: 'Dashboard', icon: 'home', bundle: 'dist/dashboard.js' },
        new Map(),
      );

      expect(result.id).toBe('ui-ext-id');
      expect(result.r2Key).toBe('ui-extensions/ws-1/tp-1/dashboard/bundle.js');
      expect(r2Mock.put).toHaveBeenCalledWith(
        'ui-extensions/ws-1/tp-1/dashboard/bundle.js',
        expect.any(ArrayBuffer),
        { httpMetadata: { contentType: 'application/javascript' } },
      );
      expect(dbMock.insert).toHaveBeenCalledTimes(1);
    });

    it('skips R2 upload when UI_BUNDLES is not configured', async () => {
      const service = new BundleUIService({
        DB: {},
      } as any);

      const result = await service.registerUIExtension(
        'ws-1',
        'tp-1',
        { path: '/settings', label: 'Settings', bundle: 'dist/settings.js' },
        new Map(),
      );

      expect(result.id).toBe('ui-ext-id');
      // DB insert should still happen
      expect(dbMock.insert).toHaveBeenCalledTimes(1);
    });

    it('includes sidebar JSON when sidebar item matches path', async () => {
      const service = new BundleUIService({
        DB: {},
        UI_BUNDLES: r2Mock,
      } as any);

      const sidebar = [{ label: 'Dashboard', icon: 'home', path: '/dashboard' }];
      await service.registerUIExtension(
        'ws-1',
        'tp-1',
        { path: '/dashboard', label: 'Dashboard', bundle: 'dist/dashboard.js' },
        new Map(),
        sidebar,
      );

      const insertCall = dbMock.insert.mock.calls[0];
      expect(insertCall).toBeDefined();
    });
  });

  describe('uploadUIAssets', () => {
    it('uploads asset files to R2', async () => {
      const service = new BundleUIService({
        DB: {},
        UI_BUNDLES: r2Mock,
      } as any);

      const files = new Map<string, ArrayBuffer>([
        ['assets/style.css', new ArrayBuffer(5)],
      ]);
      mocks.getRequiredPackageFile.mockReturnValue(new ArrayBuffer(5));

      const uploadedKeys = await service.uploadUIAssets(
        'ws-1',
        'tp-1',
        ['assets/style.css'],
        files,
      );

      expect(uploadedKeys).toHaveLength(1);
      expect(r2Mock.put).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when UI_BUNDLES is not configured', async () => {
      const service = new BundleUIService({ DB: {} } as any);

      const result = await service.uploadUIAssets('ws-1', 'tp-1', ['assets/style.css'], new Map());
      expect(result).toEqual([]);
    });

    it('deduplicates normalized file paths', async () => {
      const service = new BundleUIService({
        DB: {},
        UI_BUNDLES: r2Mock,
      } as any);

      mocks.normalizePackagePath.mockReturnValue('assets/style.css');
      mocks.getRequiredPackageFile.mockReturnValue(new ArrayBuffer(5));

      await service.uploadUIAssets(
        'ws-1',
        'tp-1',
        ['assets/style.css', './assets/style.css'],
        new Map(),
      );

      // Should only upload once due to deduplication
      expect(r2Mock.put).toHaveBeenCalledTimes(1);
    });

    it('skips empty normalized paths', async () => {
      const service = new BundleUIService({
        DB: {},
        UI_BUNDLES: r2Mock,
      } as any);

      mocks.normalizePackagePath.mockReturnValue('');

      const result = await service.uploadUIAssets('ws-1', 'tp-1', [''], new Map());
      expect(result).toEqual([]);
      expect(r2Mock.put).not.toHaveBeenCalled();
    });
  });

  describe('registerSidebarLink', () => {
    it('registers an external sidebar link', async () => {
      const service = new BundleUIService({ DB: {} } as any);

      const id = await service.registerSidebarLink(
        'ws-1',
        'tp-1',
        { label: 'External Docs', icon: 'book', url: 'https://docs.example.com' },
      );

      expect(id).toBe('ui-ext-id');
      expect(dbMock.insert).toHaveBeenCalledTimes(1);
    });
  });
});
