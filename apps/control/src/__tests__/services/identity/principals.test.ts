import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

function createMockDrizzleDb() {
  const getMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: getMock,
  };
  return {
    select: vi.fn(() => chain),
    _: { get: getMock, chain },
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
  resolveUserPrincipalId,
  resolveActorPrincipalId,
  getPrincipalById,
} from '@/services/identity/principals';

describe('principals service (Account-backed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  describe('resolveUserPrincipalId', () => {
    it('returns the account id when the user exists', async () => {
      db._.get.mockResolvedValueOnce({ id: 'user-1' });

      const result = await resolveUserPrincipalId({} as D1Database, 'user-1');
      expect(result).toBe('user-1');
    });

    it('returns null when the user is not found', async () => {
      db._.get.mockResolvedValueOnce(null);

      const result = await resolveUserPrincipalId({} as D1Database, 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when the row has a falsy id', async () => {
      db._.get.mockResolvedValueOnce({ id: '' });

      const result = await resolveUserPrincipalId({} as D1Database, 'user-1');
      expect(result).toBeNull();
    });
  });

  describe('resolveActorPrincipalId', () => {
    it('returns the account id when the actor exists', async () => {
      db._.get.mockResolvedValueOnce({ id: 'actor-1' });

      const result = await resolveActorPrincipalId({} as D1Database, 'actor-1');
      expect(result).toBe('actor-1');
    });

    it('returns null when the actor is not found', async () => {
      db._.get.mockResolvedValueOnce(null);

      const result = await resolveActorPrincipalId({} as D1Database, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getPrincipalById', () => {
    it('returns a mapped Principal when the account exists', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'user-1',
        type: 'user',
        name: 'Test User',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });

      const result = await getPrincipalById({} as D1Database, 'user-1');
      expect(result).toEqual({
        id: 'user-1',
        type: 'user',
        display_name: 'Test User',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      });
    });

    it('returns null when account does not exist', async () => {
      db._.get.mockResolvedValueOnce(null);

      const result = await getPrincipalById({} as D1Database, 'nonexistent');
      expect(result).toBeNull();
    });

    it('normalizes unknown type to service', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'svc-1',
        type: 'unknown_type',
        name: 'Service',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await getPrincipalById({} as D1Database, 'svc-1');
      expect(result?.type).toBe('service');
    });

    it('normalizes null type to service', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'svc-2',
        type: null,
        name: 'Null Type',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await getPrincipalById({} as D1Database, 'svc-2');
      expect(result?.type).toBe('service');
    });

    it('maps known principal kinds correctly', async () => {
      const knownKinds = ['user', 'space_agent', 'service', 'system', 'tenant_worker'];

      for (const kind of knownKinds) {
        db._.get.mockResolvedValueOnce({
          id: `test-${kind}`,
          type: kind,
          name: `Test ${kind}`,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        });

        const result = await getPrincipalById({} as D1Database, `test-${kind}`);
        expect(result?.type).toBe(kind);
      }
    });
  });
});
