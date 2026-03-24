import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', () => ({
  toIsoString: (value: string | Date | null | undefined) => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  },
}));

import {
  toBundleDeploymentListItem,
  buildNamespacedInfraName,
  buildDefaultBundleHostname,
  getUserPrincipalId,
  hasBundleSourceChanged,
} from '@/services/takopack/bundle-deployment-utils';

describe('toBundleDeploymentListItem', () => {
  it('maps record fields correctly', () => {
    const record = {
      id: 'tp-1',
      name: 'demo-pack',
      appId: 'dev.takos.demo',
      version: '1.2.3',
      description: 'Test description',
      icon: 'icon.svg',
      installedAt: '2026-03-01T00:00:00.000Z',
      versionMajor: 1,
      versionMinor: 2,
      versionPatch: 3,
      sourceType: 'git',
      sourceRepoId: 'repo-1',
      sourceTag: 'v1.2.3',
      sourceAssetId: 'asset-1',
      isPinned: true,
      pinnedAt: '2026-03-02T00:00:00.000Z',
      pinnedByPrincipalId: 'principal-1',
    };

    const result = toBundleDeploymentListItem(record);

    expect(result).toEqual({
      id: 'tp-1',
      name: 'demo-pack',
      appId: 'dev.takos.demo',
      version: '1.2.3',
      description: 'Test description',
      icon: 'icon.svg',
      installedAt: '2026-03-01T00:00:00.000Z',
      versionMajor: 1,
      versionMinor: 2,
      versionPatch: 3,
      sourceType: 'git',
      sourceRepoId: 'repo-1',
      sourceTag: 'v1.2.3',
      sourceAssetId: 'asset-1',
      isPinned: true,
      pinnedAt: '2026-03-02T00:00:00.000Z',
      pinnedBy: 'principal-1',
    });
  });

  it('handles null optional fields', () => {
    const record = {
      id: 'tp-1',
      name: 'demo',
      appId: 'dev.takos.demo',
      version: '1.0.0',
      description: null,
      icon: null,
      installedAt: '2026-03-01T00:00:00.000Z',
      versionMajor: 1,
      versionMinor: 0,
      versionPatch: 0,
      sourceType: null,
      sourceRepoId: null,
      sourceTag: null,
      sourceAssetId: null,
      isPinned: false,
      pinnedAt: null,
      pinnedByPrincipalId: null,
    };

    const result = toBundleDeploymentListItem(record);

    expect(result.description).toBeNull();
    expect(result.icon).toBeNull();
    expect(result.isPinned).toBe(false);
    expect(result.pinnedAt).toBeNull();
    expect(result.pinnedBy).toBeNull();
  });
});

describe('buildNamespacedInfraName', () => {
  it('appends normalized install key suffix', () => {
    const name = buildNamespacedInfraName('api-worker', 'install-key-123');
    expect(name).toMatch(/^api-worker__/);
    expect(name).toMatch(/[a-z0-9]+$/);
  });

  it('sanitizes special characters in install key', () => {
    const name = buildNamespacedInfraName('worker', 'Special!Key@#$');
    expect(name).toMatch(/^worker__/);
    // Only alphanumeric in suffix
    expect(name.split('__')[1]).toMatch(/^[a-z0-9]+$/);
  });

  it('falls back to "install" for empty install key', () => {
    const name = buildNamespacedInfraName('worker', '');
    expect(name).toBe('worker__install');
  });

  it('truncates long install key suffix', () => {
    const name = buildNamespacedInfraName('worker', 'a'.repeat(100));
    const suffix = name.split('__')[1];
    expect(suffix.length).toBeLessThanOrEqual(8);
  });
});

describe('buildDefaultBundleHostname', () => {
  it('constructs hostname from appId, installKey, and tenant domain', () => {
    const hostname = buildDefaultBundleHostname('dev.takos.demo', 'key123', 'app.test.takos.jp');
    expect(hostname).toMatch(/\.app\.test\.takos\.jp$/);
    expect(hostname).toBe(hostname.toLowerCase());
  });

  it('sanitizes special characters in appId', () => {
    const hostname = buildDefaultBundleHostname('My App!!', 'key123', 'app.test.takos.jp');
    expect(hostname).toMatch(/^[a-z0-9-]+\.app\.test\.takos\.jp$/);
  });

  it('truncates long appId', () => {
    const hostname = buildDefaultBundleHostname('a'.repeat(100), 'key123', 'app.test.takos.jp');
    const slug = hostname.split('.')[0];
    expect(slug.length).toBeLessThanOrEqual(32);
  });

  it('falls back to app- prefix for empty appId', () => {
    const hostname = buildDefaultBundleHostname('', 'key123', 'app.test.takos.jp');
    expect(hostname).toMatch(/^app-/);
  });
});

describe('getUserPrincipalId', () => {
  it('returns user account id when found', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ id: 'user-1' }),
          }),
        }),
      }),
    } as any;

    const result = await getUserPrincipalId(db, 'user-1');
    expect(result).toBe('user-1');
  });

  it('throws when user is not found', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue(null),
          }),
        }),
      }),
    } as any;

    await expect(getUserPrincipalId(db, 'nonexistent')).rejects.toThrow('User not found');
  });
});

describe('hasBundleSourceChanged', () => {
  it('returns false when nothing changed', () => {
    expect(hasBundleSourceChanged({
      previousSourceType: 'git',
      previousSourceRepoId: 'repo-1',
      nextSourceType: 'git',
      nextSourceRepoId: 'repo-1',
    })).toBe(false);
  });

  it('returns true when source type changes', () => {
    expect(hasBundleSourceChanged({
      previousSourceType: 'git',
      previousSourceRepoId: 'repo-1',
      nextSourceType: 'upload',
    })).toBe(true);
  });

  it('returns true when git repo id changes', () => {
    expect(hasBundleSourceChanged({
      previousSourceType: 'git',
      previousSourceRepoId: 'repo-1',
      nextSourceType: 'git',
      nextSourceRepoId: 'repo-2',
    })).toBe(true);
  });

  it('returns false when upload to upload', () => {
    expect(hasBundleSourceChanged({
      previousSourceType: 'upload',
      previousSourceRepoId: null,
      nextSourceType: 'upload',
    })).toBe(false);
  });

  it('returns false when both are null/undefined', () => {
    expect(hasBundleSourceChanged({
      previousSourceType: null,
      previousSourceRepoId: null,
    })).toBe(false);
  });

  it('returns true when going from null to git', () => {
    expect(hasBundleSourceChanged({
      previousSourceType: null,
      previousSourceRepoId: null,
      nextSourceType: 'git',
      nextSourceRepoId: 'repo-1',
    })).toBe(true);
  });
});
