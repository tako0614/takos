import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

function createMockDrizzleDb() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
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
  getWorkspaceByIdOrSlug,
  getWorkspaceModelSettings,
  getUserByEmail,
  getRepositoryById,
} from '@/services/identity/spaces';

describe('spaces service (Drizzle)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  describe('getWorkspaceByIdOrSlug', () => {
    it('returns mapped workspace when found by id', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'ws-1',
        type: 'team',
        name: 'My Team',
        slug: 'my-team',
        description: 'A team workspace',
        ownerAccountId: 'user-1',
        headSnapshotId: null,
        aiModel: 'gpt-5.4-nano',
        aiProvider: 'openai',
        securityPosture: 'standard',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });

      const ws = await getWorkspaceByIdOrSlug({} as D1Database, 'ws-1');

      expect(ws).not.toBeNull();
      expect(ws!.id).toBe('ws-1');
      expect(ws!.kind).toBe('team');
      expect(ws!.name).toBe('My Team');
      expect(ws!.slug).toBe('my-team');
      expect(ws!.owner_principal_id).toBe('user-1');
      expect(ws!.ai_model).toBe('gpt-5.4-nano');
      expect(ws!.security_posture).toBe('standard');
    });

    it('returns null when not found', async () => {
      db._.get.mockResolvedValueOnce(null);

      const ws = await getWorkspaceByIdOrSlug({} as D1Database, 'nonexistent');
      expect(ws).toBeNull();
    });

    it('maps user type to user kind', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'user-1',
        type: 'user',
        name: 'Alice',
        slug: 'alice',
        description: null,
        ownerAccountId: null,
        headSnapshotId: null,
        aiModel: null,
        aiProvider: null,
        securityPosture: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const ws = await getWorkspaceByIdOrSlug({} as D1Database, 'alice');
      expect(ws!.kind).toBe('user');
      // When ownerAccountId is null, owner_principal_id defaults to workspace id
      expect(ws!.owner_principal_id).toBe('user-1');
    });

    it('maps restricted_egress security posture', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'ws-secure',
        type: 'team',
        name: 'Secure Team',
        slug: 'secure',
        description: null,
        ownerAccountId: 'user-1',
        headSnapshotId: null,
        aiModel: null,
        aiProvider: null,
        securityPosture: 'restricted_egress',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const ws = await getWorkspaceByIdOrSlug({} as D1Database, 'ws-secure');
      expect(ws!.security_posture).toBe('restricted_egress');
    });
  });

  describe('getWorkspaceModelSettings', () => {
    it('returns model settings when found', async () => {
      db._.get.mockResolvedValueOnce({
        ai_model: 'gpt-5.4-nano',
        ai_provider: 'openai',
        security_posture: 'standard',
      });

      const settings = await getWorkspaceModelSettings({} as D1Database, 'ws-1');
      expect(settings).toEqual({
        ai_model: 'gpt-5.4-nano',
        ai_provider: 'openai',
        security_posture: 'standard',
      });
    });

    it('returns null when not found', async () => {
      db._.get.mockResolvedValueOnce(null);

      const settings = await getWorkspaceModelSettings({} as D1Database, 'ws-1');
      expect(settings).toBeNull();
    });

    it('returns null for invalid space ID', async () => {
      const settings = await getWorkspaceModelSettings({} as D1Database, '');
      expect(settings).toBeNull();
    });
  });

  describe('getUserByEmail', () => {
    it('returns mapped user when found', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        slug: 'alice',
        bio: 'Hello',
        picture: 'https://example.com/avatar.png',
        trustTier: 'standard',
        setupCompleted: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const user = await getUserByEmail({} as D1Database, 'alice@example.com');
      expect(user).not.toBeNull();
      expect(user!.id).toBe('user-1');
      expect(user!.email).toBe('alice@example.com');
      expect(user!.username).toBe('alice');
      expect(user!.principal_id).toBe('user-1');
      expect(user!.principal_kind).toBe('user');
    });

    it('returns null when user not found', async () => {
      db._.get.mockResolvedValueOnce(null);

      const user = await getUserByEmail({} as D1Database, 'nonexistent@example.com');
      expect(user).toBeNull();
    });

    it('handles null email field gracefully', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'user-1',
        email: null,
        name: 'NoEmail',
        slug: 'noemail',
        bio: null,
        picture: null,
        trustTier: 'standard',
        setupCompleted: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const user = await getUserByEmail({} as D1Database, 'test@example.com');
      expect(user!.email).toBe('');
    });
  });

  describe('getRepositoryById', () => {
    it('returns mapped repository when found', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'repo-1',
        accountId: 'ws-1',
        name: 'main',
        description: 'Default repo',
        visibility: 'private',
        defaultBranch: 'main',
        forkedFromId: null,
        stars: 0,
        forks: 0,
        gitEnabled: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const repo = await getRepositoryById({} as D1Database, 'repo-1');
      expect(repo).not.toBeNull();
      expect(repo!.id).toBe('repo-1');
      expect(repo!.space_id).toBe('ws-1');
      expect(repo!.name).toBe('main');
      expect(repo!.default_branch).toBe('main');
      expect(repo!.visibility).toBe('private');
    });

    it('returns null when not found', async () => {
      db._.get.mockResolvedValueOnce(null);

      const repo = await getRepositoryById({} as D1Database, 'nonexistent');
      expect(repo).toBeNull();
    });
  });
});
