import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  verifyThreadShareAccess: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock('@/services/threads/thread-shares', () => ({
  verifyThreadShareAccess: mocks.verifyThreadShareAccess,
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
}));

vi.mock('@/db/schema', () => ({
  threads: { id: 'id', title: 'title', status: 'status', createdAt: 'createdAt', updatedAt: 'updatedAt' },
  messages: { id: 'id', role: 'role', content: 'content', sequence: 'sequence', threadId: 'threadId', createdAt: 'createdAt' },
}));

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual };
});

vi.mock('@/shared/utils/rate-limiter', () => ({
  InMemoryRateLimiter: class {
    check() { return { remaining: 5, reset: Date.now() + 60000 }; }
    hit() {}
  },
}));

import publicShareRoute from '@/routes/public-share';

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Record<string, never> }>();
  app.route('/api/public', publicShareRoute);
  return app;
}

function mockDbForThread(thread: Record<string, unknown> | null, messageRows: unknown[] = []) {
  const chain: any = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    get: vi.fn().mockResolvedValue(thread),
    all: vi.fn().mockResolvedValue(messageRows),
  };
  mocks.getDb.mockReturnValue(chain);
}

describe('public-share routes', () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/public/thread-shares/:token', () => {
    it('returns shared thread for public share', async () => {
      mocks.verifyThreadShareAccess.mockResolvedValue({
        threadId: 't-1',
        share: { mode: 'public', expires_at: null, created_at: '2026-03-01T00:00:00.000Z' },
      });

      mockDbForThread(
        { id: 't-1', title: 'Shared Thread', status: 'active', createdAt: '2026-03-01', updatedAt: '2026-03-01' },
        [
          { id: 'msg-1', role: 'user', content: 'Hello', sequence: 1, createdAt: '2026-03-01' },
          { id: 'msg-2', role: 'assistant', content: 'Hi there', sequence: 2, createdAt: '2026-03-01' },
          { id: 'msg-3', role: 'system', content: 'Internal', sequence: 3, createdAt: '2026-03-01' },
        ],
      );

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/api/public/thread-shares/abc123'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('share');
      expect(json).toHaveProperty('thread');
      expect(json).toHaveProperty('messages');
    });

    it('returns 401 when password is required', async () => {
      mocks.verifyThreadShareAccess.mockResolvedValue({ error: 'password_required' });

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/api/public/thread-shares/abc123'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(401);
    });

    it('returns 404 when share not found', async () => {
      mocks.verifyThreadShareAccess.mockResolvedValue({ error: 'not_found' });

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/api/public/thread-shares/invalid-token'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 404 when thread is deleted', async () => {
      mocks.verifyThreadShareAccess.mockResolvedValue({
        threadId: 't-1',
        share: { mode: 'public', expires_at: null, created_at: '2026-03-01T00:00:00.000Z' },
      });

      mockDbForThread(
        { id: 't-1', title: 'Deleted Thread', status: 'deleted', createdAt: '2026-03-01', updatedAt: '2026-03-01' },
      );

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/api/public/thread-shares/abc123'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/public/thread-shares/:token/access', () => {
    it('returns shared thread with correct password', async () => {
      mocks.verifyThreadShareAccess.mockResolvedValue({
        threadId: 't-1',
        share: { mode: 'password', expires_at: null, created_at: '2026-03-01T00:00:00.000Z' },
      });

      mockDbForThread(
        { id: 't-1', title: 'Thread', status: 'active', createdAt: '2026-03-01', updatedAt: '2026-03-01' },
        [{ id: 'msg-1', role: 'user', content: 'Hi', sequence: 1, createdAt: '2026-03-01' }],
      );

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/api/public/thread-shares/abc123/access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'correct-password' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });

    it('returns 401 when password is required but not provided', async () => {
      mocks.verifyThreadShareAccess.mockResolvedValue({ error: 'password_required' });

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/api/public/thread-shares/abc123/access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(401);
    });

    it('returns 403 when password is incorrect', async () => {
      mocks.verifyThreadShareAccess.mockResolvedValue({ error: 'forbidden' });

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/api/public/thread-shares/abc123/access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'wrong' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
    });
  });
});
