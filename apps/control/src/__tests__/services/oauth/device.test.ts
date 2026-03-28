import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

import { normalizeUserCode } from '@/services/oauth/device';

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('normalizeUserCode', () => {
  it('uppercases and strips non-alphanumeric characters', () => {
    expect(normalizeUserCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeUserCode('ABCD-EFGH')).toBe('ABCDEFGH');
  });

  it('handles lowercase input', () => {
    expect(normalizeUserCode('abcdefgh')).toBe('ABCDEFGH');
  });

  it('strips spaces and dashes', () => {
    expect(normalizeUserCode('AB CD EF GH')).toBe('ABCDEFGH');
    expect(normalizeUserCode('AB-CD-EF-GH')).toBe('ABCDEFGH');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeUserCode('')).toBe('');
  });

  it('handles null-ish values gracefully', () => {
    expect(normalizeUserCode(null as unknown as string)).toBe('');
    expect(normalizeUserCode(undefined as unknown as string)).toBe('');
  });

  it('strips special characters', () => {
    expect(normalizeUserCode('AB!@#$%^&*()CD')).toBe('ABCD');
  });
});

// ---------------------------------------------------------------------------
// DB-dependent tests
// ---------------------------------------------------------------------------

function createMockDrizzleDb() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      })),
    })),
    _: { get: getMock, all: allMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

import {
  createDeviceAuthorization,
  getDeviceAuthorizationByUserCode,
  getDeviceAuthorizationByDeviceCode,
  approveDeviceAuthorization,
  denyDeviceAuthorization,
  consumeApprovedDeviceAuthorization,
  pollDeviceAuthorization,
} from '@/services/oauth/device';
import { OAUTH_CONSTANTS } from '@/types/oauth';

describe('createDeviceAuthorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns device code, user code, and expiry info', async () => {
    const result = await createDeviceAuthorization({} as D1Database, {
      clientId: 'client-1',
      scope: 'openid profile',
    });

    expect(result.deviceCode).toBeTruthy();
    expect(result.userCode).toBeTruthy();
    // User code should be formatted with dashes (e.g., ABCD-EFGH)
    expect(result.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(result.expiresIn).toBe(OAUTH_CONSTANTS.DEVICE_CODE_EXPIRES_IN);
    expect(result.interval).toBe(OAUTH_CONSTANTS.DEVICE_POLL_INTERVAL_SECONDS);
    expect(result.id).toBeTruthy();
  });

  it('uses custom expiry and interval when provided', async () => {
    const result = await createDeviceAuthorization({} as D1Database, {
      clientId: 'client-1',
      scope: 'openid',
      expiresInSeconds: 1800,
      intervalSeconds: 10,
    });

    expect(result.expiresIn).toBe(1800);
    expect(result.interval).toBe(10);
  });
});

describe('getDeviceAuthorizationByUserCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns null for empty user code', async () => {
    const result = await getDeviceAuthorizationByUserCode({} as D1Database, '');
    expect(result).toBeNull();
  });

  it('returns null when not found', async () => {
    db._.get.mockResolvedValueOnce(null);
    const result = await getDeviceAuthorizationByUserCode({} as D1Database, 'ABCD-EFGH');
    expect(result).toBeNull();
  });

  it('returns mapped device code when found', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'dc-1',
      deviceCodeHash: 'hash1',
      userCodeHash: 'hash2',
      clientId: 'client-1',
      scope: 'openid',
      status: 'pending',
      accountId: null,
      intervalSeconds: 5,
      lastPolledAt: null,
      approvedAt: null,
      deniedAt: null,
      usedAt: null,
      expiresAt: '2026-01-01T01:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await getDeviceAuthorizationByUserCode({} as D1Database, 'ABCDEFGH');
    expect(result).not.toBeNull();
    expect(result!.client_id).toBe('client-1');
    expect(result!.status).toBe('pending');
  });
});

describe('getDeviceAuthorizationByDeviceCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns null for empty device code', async () => {
    const result = await getDeviceAuthorizationByDeviceCode({} as D1Database, '');
    expect(result).toBeNull();
  });

  it('returns null when not found', async () => {
    db._.get.mockResolvedValueOnce(null);
    const result = await getDeviceAuthorizationByDeviceCode({} as D1Database, 'some-code');
    expect(result).toBeNull();
  });
});

describe('approveDeviceAuthorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns true when successfully approved', async () => {
    const result = await approveDeviceAuthorization({} as D1Database, {
      id: 'dc-1',
      userId: 'user-1',
    });
    expect(result).toBe(true);
  });
});

describe('denyDeviceAuthorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns true when successfully denied', async () => {
    const result = await denyDeviceAuthorization({} as D1Database, {
      id: 'dc-1',
      userId: 'user-1',
    });
    expect(result).toBe(true);
  });
});

describe('pollDeviceAuthorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns not_found for empty device code', async () => {
    const result = await pollDeviceAuthorization({} as D1Database, {
      deviceCode: '',
      clientId: 'client-1',
    });
    expect(result.kind).toBe('not_found');
  });

  it('returns not_found when device code not in database', async () => {
    db._.get.mockResolvedValueOnce(null);
    const result = await pollDeviceAuthorization({} as D1Database, {
      deviceCode: 'nonexistent',
      clientId: 'client-1',
    });
    expect(result.kind).toBe('not_found');
  });

  it('returns client_mismatch when client IDs differ', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'dc-1',
      deviceCodeHash: 'hash',
      userCodeHash: 'hash',
      clientId: 'client-1',
      scope: 'openid',
      status: 'pending',
      accountId: null,
      intervalSeconds: 5,
      lastPolledAt: null,
      approvedAt: null,
      deniedAt: null,
      usedAt: null,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await pollDeviceAuthorization({} as D1Database, {
      deviceCode: 'some-code',
      clientId: 'different-client',
    });
    expect(result.kind).toBe('client_mismatch');
  });

  it('returns expired when device code has expired', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'dc-1',
      deviceCodeHash: 'hash',
      userCodeHash: 'hash',
      clientId: 'client-1',
      scope: 'openid',
      status: 'pending',
      accountId: null,
      intervalSeconds: 5,
      lastPolledAt: null,
      approvedAt: null,
      deniedAt: null,
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000).toISOString(), // expired
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await pollDeviceAuthorization({} as D1Database, {
      deviceCode: 'some-code',
      clientId: 'client-1',
    });
    expect(result.kind).toBe('expired');
  });
});

describe('consumeApprovedDeviceAuthorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns true when successfully consumed', async () => {
    const result = await consumeApprovedDeviceAuthorization({} as D1Database, 'dc-1');
    expect(result).toBe(true);
  });
});
