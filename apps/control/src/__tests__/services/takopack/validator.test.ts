import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  capabilityRegistryValidate: vi.fn(),
  resolveAllowedCapabilities: vi.fn(),
  inferRequiredCapabilitiesFromManifest: vi.fn(),
  normalizeTakosScopes: vi.fn(),
  listWorkspaceCommonEnv: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/platform/capabilities', () => ({
  capabilityRegistry: {
    validate: mocks.capabilityRegistryValidate,
  },
  resolveAllowedCapabilities: mocks.resolveAllowedCapabilities,
}));

vi.mock('@/services/takopack/capability-scan', () => ({
  inferRequiredCapabilitiesFromManifest: mocks.inferRequiredCapabilitiesFromManifest,
}));

vi.mock('@/services/common-env', () => ({
  CommonEnvService: class {
    listWorkspaceCommonEnv = mocks.listWorkspaceCommonEnv;
  },
  TAKOS_ACCESS_TOKEN_ENV_NAME: 'TAKOS_ACCESS_TOKEN',
}));

vi.mock('@/services/common-env/crypto', () => ({
  uniqueEnvNames: (names: string[]) => [...new Set(names)],
  MANAGED_COMMON_ENV_KEYS: new Set<string>(),
}));

vi.mock('@/services/common-env/takos-builtins', () => ({
  normalizeTakosScopes: mocks.normalizeTakosScopes,
  TAKOS_ACCESS_TOKEN_ENV_NAME: 'TAKOS_ACCESS_TOKEN',
}));

import {
  asJsonObject,
  parseJsonObject,
  normalizeTakosBaseUrl,
  resolveTakosUrlSource,
  parseRepoRef,
  normalizeDependencies,
  validateManifestForInstall,
} from '@/services/takopack/validator';
import type { TakopackManifest } from '@/services/takopack/types';

describe('asJsonObject', () => {
  it('returns object for plain objects', () => {
    expect(asJsonObject({ a: 1 })).toEqual({ a: 1 });
  });

  it('returns null for arrays', () => {
    expect(asJsonObject([1, 2, 3])).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(asJsonObject(null)).toBeNull();
    expect(asJsonObject(undefined)).toBeNull();
  });

  it('returns null for primitives', () => {
    expect(asJsonObject('string')).toBeNull();
    expect(asJsonObject(42)).toBeNull();
    expect(asJsonObject(true)).toBeNull();
  });
});

describe('parseJsonObject', () => {
  it('parses valid JSON object string', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for null/undefined/empty', () => {
    expect(parseJsonObject(null)).toBeNull();
    expect(parseJsonObject(undefined)).toBeNull();
    expect(parseJsonObject('')).toBeNull();
  });

  it('returns null for JSON array string', () => {
    expect(parseJsonObject('[1,2]')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseJsonObject('not-json')).toBeNull();
  });
});

describe('normalizeTakosBaseUrl', () => {
  it('normalizes a valid https URL', () => {
    expect(normalizeTakosBaseUrl('https://takos.example.com/')).toBe('https://takos.example.com');
  });

  it('normalizes a valid http URL', () => {
    expect(normalizeTakosBaseUrl('http://localhost:8787/')).toBe('http://localhost:8787');
  });

  it('strips trailing slashes', () => {
    expect(normalizeTakosBaseUrl('https://example.com///')).toBe('https://example.com');
  });

  it('strips hash fragments', () => {
    expect(normalizeTakosBaseUrl('https://example.com#fragment')).toBe('https://example.com');
  });

  it('throws for invalid URL', () => {
    expect(() => normalizeTakosBaseUrl('not-a-url')).toThrow('Invalid takosBaseUrl');
  });

  it('throws for unsupported protocol', () => {
    expect(() => normalizeTakosBaseUrl('ftp://example.com')).toThrow('Invalid takosBaseUrl protocol');
  });
});

describe('resolveTakosUrlSource', () => {
  it('returns normalized explicit takosBaseUrl', () => {
    expect(resolveTakosUrlSource({ takosBaseUrl: 'https://api.example.com/' })).toBe('https://api.example.com');
  });

  it('falls back to adminDomain when takosBaseUrl is empty', () => {
    expect(resolveTakosUrlSource({ adminDomain: 'test.takos.jp' })).toBe('https://test.takos.jp');
  });

  it('prefers takosBaseUrl over adminDomain', () => {
    expect(resolveTakosUrlSource({
      takosBaseUrl: 'https://explicit.com',
      adminDomain: 'admin.takos.jp',
    })).toBe('https://explicit.com');
  });

  it('returns null when neither is available', () => {
    expect(resolveTakosUrlSource({})).toBeNull();
    expect(resolveTakosUrlSource({ takosBaseUrl: '', adminDomain: '' })).toBeNull();
  });
});

describe('parseRepoRef', () => {
  it('parses @user/repo format', () => {
    expect(parseRepoRef('@alice/my-repo')).toEqual({ username: 'alice', repoName: 'my-repo' });
  });

  it('parses user/repo format without @', () => {
    expect(parseRepoRef('alice/my-repo')).toEqual({ username: 'alice', repoName: 'my-repo' });
  });

  it('returns null for empty string', () => {
    expect(parseRepoRef('')).toBeNull();
  });

  it('returns null for invalid format', () => {
    expect(parseRepoRef('noslash')).toBeNull();
    expect(parseRepoRef('/leading-slash')).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(parseRepoRef(null as unknown as string)).toBeNull();
    expect(parseRepoRef(undefined as unknown as string)).toBeNull();
  });
});

describe('normalizeDependencies', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeDependencies(null)).toEqual([]);
    expect(normalizeDependencies(undefined)).toEqual([]);
    expect(normalizeDependencies('string')).toEqual([]);
  });

  it('filters out entries with missing repo or version', () => {
    expect(normalizeDependencies([
      { repo: '@alice/a', version: '^1.0.0' },
      { repo: '', version: '^1.0.0' },
      { repo: '@alice/b', version: '' },
    ])).toEqual([{ repo: '@alice/a', version: '^1.0.0' }]);
  });

  it('throws on duplicate repo references', () => {
    expect(() => normalizeDependencies([
      { repo: '@alice/repo', version: '^1.0.0' },
      { repo: '@Alice/Repo', version: '^2.0.0' },
    ])).toThrow('Duplicate dependency declaration');
  });

  it('throws on invalid repo reference format', () => {
    expect(() => normalizeDependencies([
      { repo: 'invalid-no-slash', version: '^1.0.0' },
    ])).toThrow('Invalid dependency repo reference');
  });

  it('normalizes valid dependencies', () => {
    const result = normalizeDependencies([
      { repo: '@alice/alpha', version: '^1.0.0' },
      { repo: '@bob/beta', version: '~2.3.0' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ repo: '@alice/alpha', version: '^1.0.0' });
    expect(result[1]).toEqual({ repo: '@bob/beta', version: '~2.3.0' });
  });
});

describe('validateManifestForInstall', () => {
  const baseManifest: TakopackManifest = {
    manifestVersion: 'vnext-infra-v1alpha1',
    meta: {
      name: 'test-app',
      appId: 'dev.takos.test-app',
      version: '1.0.0',
      createdAt: '2026-03-01T00:00:00.000Z',
    },
    objects: [],
  };

  const mockEnv = {
    DB: {},
    ADMIN_DOMAIN: 'test.takos.jp',
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue(null),
          }),
        }),
      }),
    });
    mocks.capabilityRegistryValidate.mockReturnValue({ known: [], unknown: [], duplicates: [] });
    mocks.resolveAllowedCapabilities.mockResolvedValue({ allowed: new Set() });
    mocks.inferRequiredCapabilitiesFromManifest.mockReturnValue([]);
    mocks.listWorkspaceCommonEnv.mockResolvedValue([]);
  });

  it('throws when autoEnv is enabled without explicit approval', async () => {
    const manifest = {
      ...baseManifest,
      oauth: {
        clientName: 'Test',
        redirectUris: ['https://example.com/cb'],
        scopes: ['openid'],
        autoEnv: true,
      },
    };

    await expect(
      validateManifestForInstall({
        env: mockEnv,
        manifest,
        spaceId: 'ws-1',
        userId: 'user-1',
        requireAutoEnvApproval: true,
        oauthAutoEnvApproved: false,
      }),
    ).rejects.toThrow('explicit installer approval');
  });

  it('throws when TAKOS_ACCESS_TOKEN is required without scopes', async () => {
    const manifest = {
      ...baseManifest,
      env: { required: ['TAKOS_ACCESS_TOKEN'] },
    };

    await expect(
      validateManifestForInstall({
        env: mockEnv,
        manifest,
        spaceId: 'ws-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('Package.spec.takos.scopes is missing');
  });

  it('throws when unknown capabilities are declared', async () => {
    const manifest = {
      ...baseManifest,
      capabilities: ['unknown.cap'],
    };
    mocks.capabilityRegistryValidate.mockReturnValue({
      known: [],
      unknown: ['unknown.cap'],
      duplicates: [],
    });

    await expect(
      validateManifestForInstall({
        env: mockEnv,
        manifest,
        spaceId: 'ws-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('Unknown capabilities');
  });

  it('throws when duplicate capabilities are declared', async () => {
    const manifest = {
      ...baseManifest,
      capabilities: ['storage.write', 'storage.write'],
    };
    mocks.capabilityRegistryValidate.mockReturnValue({
      known: ['storage.write'],
      unknown: [],
      duplicates: ['storage.write'],
    });

    await expect(
      validateManifestForInstall({
        env: mockEnv,
        manifest,
        spaceId: 'ws-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('Duplicate capabilities');
  });

  it('throws when capabilities are denied by policy', async () => {
    const manifest = {
      ...baseManifest,
    };
    mocks.inferRequiredCapabilitiesFromManifest.mockReturnValue(['storage.write']);
    mocks.resolveAllowedCapabilities.mockResolvedValue({ allowed: new Set() });

    await expect(
      validateManifestForInstall({
        env: mockEnv,
        manifest,
        spaceId: 'ws-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('Capability not allowed');
  });

  it('returns result when validation passes with no env requirements', async () => {
    const result = await validateManifestForInstall({
      env: mockEnv,
      manifest: baseManifest,
      spaceId: 'ws-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      requiredEnvKeys: [],
      requestedCapabilities: [],
      appBaseUrlForAutoEnv: null,
    });
  });
});
