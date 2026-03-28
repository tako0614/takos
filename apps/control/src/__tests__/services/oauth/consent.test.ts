import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

function createMockDrizzleDb() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
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
  revokeAllUserClientTokens: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

vi.mock('@/services/oauth/token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/oauth/token')>();
  return { ...actual, revokeAllUserClientTokens: mocks.revokeAllUserClientTokens };
});

import {
  getConsent,
  hasFullConsent,
  getNewScopes,
  grantConsent,
  getUserConsents,
} from '@/services/oauth/consent';

describe('consent service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  describe('getConsent', () => {
    it('returns mapped consent when found', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid","profile"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const consent = await getConsent({} as D1Database, 'user-1', 'client-1');

      expect(consent).not.toBeNull();
      expect(consent!.user_id).toBe('user-1');
      expect(consent!.client_id).toBe('client-1');
      expect(consent!.scopes).toBe('["openid","profile"]');
      expect(consent!.status).toBe('active');
    });

    it('returns null when no consent exists', async () => {
      db._.get.mockResolvedValueOnce(null);

      const consent = await getConsent({} as D1Database, 'user-1', 'client-1');
      expect(consent).toBeNull();
    });
  });

  describe('hasFullConsent', () => {
    it('returns true when all requested scopes are granted', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid","profile","email"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await hasFullConsent({} as D1Database, 'user-1', 'client-1', ['openid', 'profile']);
      expect(result).toBe(true);
    });

    it('returns false when some scopes are not granted', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await hasFullConsent({} as D1Database, 'user-1', 'client-1', ['openid', 'profile']);
      expect(result).toBe(false);
    });

    it('returns false when no consent exists', async () => {
      db._.get.mockResolvedValueOnce(null);

      const result = await hasFullConsent({} as D1Database, 'user-1', 'client-1', ['openid']);
      expect(result).toBe(false);
    });
  });

  describe('getNewScopes', () => {
    it('returns only scopes not yet granted', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await getNewScopes({} as D1Database, 'user-1', 'client-1', ['openid', 'profile', 'email']);
      expect(result).toEqual(['profile', 'email']);
    });

    it('returns all requested scopes when no consent exists', async () => {
      db._.get.mockResolvedValueOnce(null);

      const result = await getNewScopes({} as D1Database, 'user-1', 'client-1', ['openid', 'profile']);
      expect(result).toEqual(['openid', 'profile']);
    });

    it('returns empty array when all scopes are already granted', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid","profile"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await getNewScopes({} as D1Database, 'user-1', 'client-1', ['openid', 'profile']);
      expect(result).toEqual([]);
    });
  });

  describe('grantConsent', () => {
    it('creates new consent when none exists', async () => {
      db._.get.mockResolvedValueOnce(null); // getConsent returns null

      const consent = await grantConsent({} as D1Database, 'user-1', 'client-1', ['openid', 'profile']);

      expect(consent.user_id).toBe('user-1');
      expect(consent.client_id).toBe('client-1');
      expect(consent.status).toBe('active');
      expect(JSON.parse(consent.scopes)).toEqual(['openid', 'profile']);
    });

    it('merges scopes when consent already exists', async () => {
      // getConsent finds existing
      db._.get.mockResolvedValueOnce({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const consent = await grantConsent({} as D1Database, 'user-1', 'client-1', ['profile', 'email']);

      // Should merge existing [openid] with new [profile, email]
      const mergedScopes = JSON.parse(consent.scopes);
      expect(mergedScopes).toContain('openid');
      expect(mergedScopes).toContain('profile');
      expect(mergedScopes).toContain('email');
    });

    it('deduplicates scopes when merging', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid","profile"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const consent = await grantConsent({} as D1Database, 'user-1', 'client-1', ['openid', 'email']);

      const mergedScopes = JSON.parse(consent.scopes);
      // No duplicates
      const uniqueScopes = [...new Set(mergedScopes)];
      expect(mergedScopes.length).toBe(uniqueScopes.length);
    });
  });

  describe('getUserConsents', () => {
    it('returns mapped consent list', async () => {
      db._.all.mockResolvedValueOnce([
        {
          id: 'consent-1',
          accountId: 'user-1',
          clientId: 'client-1',
          scopes: '["openid"]',
          status: 'active',
          grantedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'consent-2',
          accountId: 'user-1',
          clientId: 'client-2',
          scopes: '["openid","profile"]',
          status: 'active',
          grantedAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ]);

      const consents = await getUserConsents({} as D1Database, 'user-1');
      expect(consents).toHaveLength(2);
      expect(consents[0]!.client_id).toBe('client-1');
      expect(consents[1]!.client_id).toBe('client-2');
    });

    it('returns empty array when no consents exist', async () => {
      db._.all.mockResolvedValueOnce([]);

      const consents = await getUserConsents({} as D1Database, 'user-1');
      expect(consents).toEqual([]);
    });
  });
});
