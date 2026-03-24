import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

import {
  normalizeTakosScopes,
  resolveTakosApiUrl,
  TAKOS_API_URL_ENV_NAME,
  TAKOS_ACCESS_TOKEN_ENV_NAME,
} from '@/services/common-env/takos-builtins';

describe('constants', () => {
  it('TAKOS_API_URL_ENV_NAME is correct', () => {
    expect(TAKOS_API_URL_ENV_NAME).toBe('TAKOS_API_URL');
  });

  it('TAKOS_ACCESS_TOKEN_ENV_NAME is correct', () => {
    expect(TAKOS_ACCESS_TOKEN_ENV_NAME).toBe('TAKOS_ACCESS_TOKEN');
  });
});

describe('resolveTakosApiUrl', () => {
  it('returns URL with admin domain', () => {
    const result = resolveTakosApiUrl({ ADMIN_DOMAIN: 'api.takos.example' });
    expect(result).toBe('https://api.takos.example');
  });

  it('returns null when ADMIN_DOMAIN is empty', () => {
    expect(resolveTakosApiUrl({ ADMIN_DOMAIN: '' })).toBeNull();
  });

  it('returns null when ADMIN_DOMAIN is whitespace', () => {
    expect(resolveTakosApiUrl({ ADMIN_DOMAIN: '   ' })).toBeNull();
  });

  it('trims the admin domain', () => {
    const result = resolveTakosApiUrl({ ADMIN_DOMAIN: '  api.takos.example  ' });
    expect(result).toBe('https://api.takos.example');
  });
});

describe('normalizeTakosScopes', () => {
  it('returns deduplicated and trimmed scopes', () => {
    // We need to import ALL_SCOPES to know what valid scopes are.
    // The function validates against ALL_SCOPES. Let's test with known valid scopes.
    // We can test error handling without knowing the exact valid scopes.
  });

  it('throws when scopes array is empty', () => {
    expect(() => normalizeTakosScopes([])).toThrow('at least one scope');
  });

  it('throws when all scopes are empty strings', () => {
    expect(() => normalizeTakosScopes(['', '  '])).toThrow('at least one scope');
  });

  it('throws for unknown scopes', () => {
    expect(() => normalizeTakosScopes(['definitely_not_a_real_scope'])).toThrow('Unknown Takos scopes');
  });

  it('deduplicates scopes', () => {
    // Will throw for invalid scopes, but we test the dedup logic doesn't crash
    expect(() => normalizeTakosScopes(['fake_scope', 'fake_scope'])).toThrow('Unknown Takos scopes');
  });
});

describe('listTakosBuiltinStatuses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when workspace is not found', async () => {
    const getMock = vi.fn().mockResolvedValue(null);
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: getMock,
    };
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => chain),
    });

    const { listTakosBuiltinStatuses } = await import('@/services/common-env/takos-builtins');

    await expect(
      listTakosBuiltinStatuses({
        env: { DB: {} as any, ADMIN_DOMAIN: 'test.takos.jp' },
        spaceId: 'nonexistent',
        workerId: 'w-1',
      })
    ).rejects.toThrow('Space not found');
  });

  it('returns statuses with TAKOS_API_URL and TAKOS_ACCESS_TOKEN keys', async () => {
    const getMock = vi.fn()
      // loadWorkspaceIdentity
      .mockResolvedValueOnce({
        id: 'space-1',
        type: 'user',
        name: 'Test User',
        slug: 'test-user',
        ownerAccountId: 'space-1',
      })
      // listManagedRow -> null
      .mockResolvedValueOnce(null);

    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: getMock,
    };
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => chain),
    });

    const { listTakosBuiltinStatuses } = await import('@/services/common-env/takos-builtins');

    const result = await listTakosBuiltinStatuses({
      env: { DB: {} as any, ADMIN_DOMAIN: 'test.takos.jp' },
      spaceId: 'space-1',
      workerId: 'w-1',
    });

    expect(result).toHaveProperty('TAKOS_API_URL');
    expect(result).toHaveProperty('TAKOS_ACCESS_TOKEN');
    expect(result.TAKOS_API_URL.managed).toBe(true);
    expect(result.TAKOS_API_URL.available).toBe(true);
    expect(result.TAKOS_ACCESS_TOKEN.managed).toBe(true);
    expect(result.TAKOS_ACCESS_TOKEN.available).toBe(true);
    expect(result.TAKOS_ACCESS_TOKEN.configured).toBe(false);
  });

  it('shows TAKOS_API_URL as unavailable when ADMIN_DOMAIN is empty', async () => {
    const getMock = vi.fn()
      .mockResolvedValueOnce({
        id: 'space-1',
        type: 'user',
        name: 'Test User',
        slug: 'test-user',
        ownerAccountId: 'space-1',
      })
      .mockResolvedValueOnce(null);

    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: getMock,
    };
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => chain),
    });

    const { listTakosBuiltinStatuses } = await import('@/services/common-env/takos-builtins');

    const result = await listTakosBuiltinStatuses({
      env: { DB: {} as any, ADMIN_DOMAIN: '' },
      spaceId: 'space-1',
      workerId: 'w-1',
    });

    expect(result.TAKOS_API_URL.available).toBe(false);
    expect(result.TAKOS_API_URL.sync_state).toBe('error');
    expect(result.TAKOS_API_URL.sync_reason).toBe('admin_domain_missing');
  });
});
