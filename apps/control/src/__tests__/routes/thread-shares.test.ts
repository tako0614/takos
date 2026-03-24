import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  checkThreadAccess: vi.fn(),
  createThreadShare: vi.fn(),
  listThreadShares: vi.fn(),
  revokeThreadShare: vi.fn(),
}));

vi.mock('@/services/threads/threads', () => ({
  checkThreadAccess: mocks.checkThreadAccess,
}));

vi.mock('@/services/threads/thread-shares', () => ({
  createThreadShare: mocks.createThreadShare,
  listThreadShares: mocks.listThreadShares,
  revokeThreadShare: mocks.revokeThreadShare,
}));

import threadSharesRoute from '@/routes/thread-shares';

function createUser(): User {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    name: 'User One',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  };
}

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api', threadSharesRoute);
  return app;
}

describe('thread-shares routes', () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/threads/:id/share', () => {
    it('creates a public share and returns 201', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.createThreadShare.mockResolvedValue({
        share: { token: 'token123', mode: 'public' },
        passwordRequired: false,
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'public' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(201);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('share');
      expect(json).toHaveProperty('share_path', '/share/token123');
      expect(json).toHaveProperty('share_url');
      expect(json.password_required).toBe(false);
    });

    it('creates a password-protected share', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.createThreadShare.mockResolvedValue({
        share: { token: 'token456', mode: 'password' },
        passwordRequired: true,
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'password', password: 'secret123' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(201);
      const json = await res.json() as Record<string, unknown>;
      expect(json.password_required).toBe(true);
    });

    it('returns 404 when thread not found', async () => {
      mocks.checkThreadAccess.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-missing/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'public' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('rejects expires_in_days > 365', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expires_in_days: 400 }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });

    it('rejects expires_in_days <= 0', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expires_in_days: 0 }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });

    it('returns 400 when createThreadShare throws', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.createThreadShare.mockRejectedValue(new Error('Share creation failed'));

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'public' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/threads/:id/shares', () => {
    it('returns list of shares with URLs', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.listThreadShares.mockResolvedValue([
        { id: 's-1', token: 'abc', mode: 'public' },
        { id: 's-2', token: 'def', mode: 'password' },
      ]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/shares'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { shares: Array<{ share_path: string; share_url: string }> };
      expect(json.shares).toHaveLength(2);
      expect(json.shares[0].share_path).toBe('/share/abc');
      expect(json.shares[1].share_path).toBe('/share/def');
    });

    it('returns 404 when thread not found', async () => {
      mocks.checkThreadAccess.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-missing/shares'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/threads/:id/shares/:shareId/revoke', () => {
    it('revokes a share successfully', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.revokeThreadShare.mockResolvedValue(true);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/shares/s-1/revoke', {
          method: 'POST',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ success: true });
    });

    it('returns 404 when share not found', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.revokeThreadShare.mockResolvedValue(false);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/shares/s-missing/revoke', {
          method: 'POST',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 404 when thread not found', async () => {
      mocks.checkThreadAccess.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-missing/shares/s-1/revoke', {
          method: 'POST',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });
});
