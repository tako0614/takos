import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';

function createMockDrizzleDb() {
  const getMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    get: getMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    _: { get: getMock, run: runMock, chain },
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
  issueTakosAccessToken,
  validateTakosAccessToken,
  validateTakosPersonalAccessToken,
} from '@/services/identity/takos-access-tokens';

describe('issueTakosAccessToken', () => {
  it('generates a token with tak_pat_ prefix', async () => {
    const { token, tokenHash, tokenPrefix } = await issueTakosAccessToken();

    expect(token).toMatch(/^tak_pat_/);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenPrefix).toBe(token.slice(0, 12));
    expect(tokenPrefix.length).toBe(12);
  });

  it('produces unique tokens on successive calls', async () => {
    const a = await issueTakosAccessToken();
    const b = await issueTakosAccessToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe('validateTakosAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns managed_builtin validation when managed token matches', async () => {
    // First call: managed token lookup
    db._.get.mockResolvedValueOnce({
      id: 'tok-1',
      subjectAccountId: 'user-1',
      scopesJson: '["spaces:read", "files:read"]',
    });

    const result = await validateTakosAccessToken({} as D1Database, 'some-token');

    expect(result).toEqual({
      userId: 'user-1',
      scopes: ['spaces:read', 'files:read'],
      tokenKind: 'managed_builtin',
    });
  });

  it('falls through to personal token validation when managed returns null', async () => {
    // Managed token lookup returns null
    db._.get.mockResolvedValueOnce(null);
    // Personal token lookup returns a match
    db._.get.mockResolvedValueOnce({
      id: 'pat-1',
      accountId: 'user-2',
      scopes: '["openid"]',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const result = await validateTakosAccessToken({} as D1Database, 'some-token');

    expect(result).toEqual({
      userId: 'user-2',
      scopes: ['openid'],
      tokenKind: 'personal',
    });
  });

  it('returns null when neither managed nor personal token matches', async () => {
    db._.get.mockResolvedValueOnce(null);
    db._.get.mockResolvedValueOnce(null);

    const result = await validateTakosAccessToken({} as D1Database, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when managed token has missing required scopes', async () => {
    // Managed token found but scopes don't match
    db._.get.mockResolvedValueOnce({
      id: 'tok-1',
      subjectAccountId: 'user-1',
      scopesJson: '["spaces:read"]',
    });
    // Personal token lookup also returns null
    db._.get.mockResolvedValueOnce(null);

    const result = await validateTakosAccessToken({} as D1Database, 'some-token', ['spaces:write']);
    expect(result).toBeNull();
  });

  it('returns null when personal token is expired', async () => {
    db._.get.mockResolvedValueOnce(null); // managed not found
    db._.get.mockResolvedValueOnce({
      id: 'pat-1',
      accountId: 'user-1',
      scopes: '["openid"]',
      expiresAt: new Date(Date.now() - 3600_000).toISOString(), // expired
    });

    const result = await validateTakosAccessToken({} as D1Database, 'some-token');
    expect(result).toBeNull();
  });

  it('returns all scopes when scopesJson is "*"', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'tok-1',
      subjectAccountId: 'user-1',
      scopesJson: '*',
    });

    const result = await validateTakosAccessToken({} as D1Database, 'some-token');
    expect(result).not.toBeNull();
    expect(result!.tokenKind).toBe('managed_builtin');
    // Should contain all scopes from ALL_SCOPES
    expect(result!.scopes.length).toBeGreaterThan(0);
    expect(result!.scopes).toContain('openid');
    expect(result!.scopes).toContain('spaces:read');
  });

  it('returns null when scopesJson is invalid JSON', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'tok-1',
      subjectAccountId: 'user-1',
      scopesJson: 'not-json',
    });
    // Falls through to personal
    db._.get.mockResolvedValueOnce(null);

    const result = await validateTakosAccessToken({} as D1Database, 'some-token');
    expect(result).toBeNull();
  });
});

describe('validateTakosPersonalAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('validates only personal tokens (not managed)', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'pat-1',
      accountId: 'user-1',
      scopes: '["openid"]',
      expiresAt: null, // no expiry
    });

    const result = await validateTakosPersonalAccessToken({} as D1Database, 'some-token');

    expect(result).toEqual({
      userId: 'user-1',
      scopes: ['openid'],
      tokenKind: 'personal',
    });
  });

  it('returns null when personal token not found', async () => {
    db._.get.mockResolvedValueOnce(null);

    const result = await validateTakosPersonalAccessToken({} as D1Database, 'nonexistent');
    expect(result).toBeNull();
  });
});
