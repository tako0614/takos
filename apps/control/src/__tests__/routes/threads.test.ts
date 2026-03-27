import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  checkThreadAccess: vi.fn(),
  createMessage: vi.fn(),
  createThread: vi.fn(),
  listThreads: vi.fn(),
  updateThread: vi.fn(),
  updateThreadStatus: vi.fn(),
  createThreadShare: vi.fn(),
  listThreadShares: vi.fn(),
  revokeThreadShare: vi.fn(),
  searchSpaceThreads: vi.fn(),
  searchThreadMessages: vi.fn(),
  getThreadTimeline: vi.fn(),
  getThreadHistory: vi.fn(),
  exportThread: vi.fn(),
  requireSpaceAccess: vi.fn(),
  getPlatformServices: vi.fn(),
}));

vi.mock('@/services/threads/thread-service', () => ({
  checkThreadAccess: mocks.checkThreadAccess,
  createMessage: mocks.createMessage,
  createThread: mocks.createThread,
  listThreads: mocks.listThreads,
  updateThread: mocks.updateThread,
  updateThreadStatus: mocks.updateThreadStatus,
}));

vi.mock('@/services/threads/thread-shares', () => ({
  createThreadShare: mocks.createThreadShare,
  listThreadShares: mocks.listThreadShares,
  revokeThreadShare: mocks.revokeThreadShare,
}));

vi.mock('@/services/threads/thread-search', () => ({
  searchSpaceThreads: mocks.searchSpaceThreads,
  searchThreadMessages: mocks.searchThreadMessages,
}));

vi.mock('@/services/threads/thread-timeline', () => ({
  getThreadTimeline: mocks.getThreadTimeline,
}));

vi.mock('@/services/threads/thread-history', () => ({
  getThreadHistory: mocks.getThreadHistory,
}));

vi.mock('@/services/threads/thread-export', () => ({
  exportThread: mocks.exportThread,
}));

vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireSpaceAccess: mocks.requireSpaceAccess,
  };
});

vi.mock('@/platform/accessors.ts', () => ({
  getPlatformServices: mocks.getPlatformServices,
}));

import threadsRoute from '@/routes/threads';

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
  app.route('/api', threadsRoute);
  return app;
}

describe('threads routes', () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSpaceAccess.mockResolvedValue({ workspace: { id: 'ws-1' } });
    mocks.getPlatformServices.mockReturnValue({
      documents: { renderPdf: vi.fn() },
    });
  });

  describe('GET /api/spaces/:spaceId/threads', () => {
    it('returns threads list', async () => {
      mocks.listThreads.mockResolvedValue([{ id: 't-1', title: 'Test' }]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/threads'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        threads: [{ id: 't-1', title: 'Test' }],
      });
    });

    it('passes status filter', async () => {
      mocks.listThreads.mockResolvedValue([]);

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/threads?status=active'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(mocks.listThreads).toHaveBeenCalledWith(
        env.DB,
        'ws-1',
        { status: 'active' },
      );
    });
  });

  describe('POST /api/spaces/:spaceId/threads', () => {
    it('creates a thread and returns 201', async () => {
      mocks.createThread.mockResolvedValue({ id: 't-new', title: 'New Thread' });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Thread' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(201);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('thread');
    });
  });

  describe('GET /api/threads/:id', () => {
    it('returns thread with access role', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', title: 'Test', space_id: 'ws-1' },
        role: 'owner',
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('thread');
      expect(json).toHaveProperty('role', 'owner');
    });

    it('returns 404 when access denied', async () => {
      mocks.checkThreadAccess.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-missing'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/threads/:id', () => {
    it('updates thread title', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.updateThread.mockResolvedValue({ id: 't-1', title: 'Updated' });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Updated' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });

    it('returns 400 when no valid updates provided', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });

    it('validates context_window range', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context_window: 5 }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /api/threads/:id', () => {
    it('soft-deletes a thread', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.updateThreadStatus.mockResolvedValue(undefined);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1', { method: 'DELETE' }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ success: true });
      expect(mocks.updateThreadStatus).toHaveBeenCalledWith(env.DB, 't-1', 'deleted');
    });
  });

  describe('POST /api/threads/:id/archive', () => {
    it('archives a thread', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.updateThreadStatus.mockResolvedValue(undefined);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/archive', { method: 'POST' }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(mocks.updateThreadStatus).toHaveBeenCalledWith(env.DB, 't-1', 'archived');
    });
  });

  describe('POST /api/threads/:id/unarchive', () => {
    it('unarchives a thread', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'editor',
      });
      mocks.updateThreadStatus.mockResolvedValue(undefined);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/unarchive', { method: 'POST' }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(mocks.updateThreadStatus).toHaveBeenCalledWith(env.DB, 't-1', 'active');
    });
  });

  describe('GET /api/threads/:id/messages', () => {
    it('returns timeline messages', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.getThreadTimeline.mockResolvedValue({ messages: [] });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/messages'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/threads/:id/messages', () => {
    it('creates a message and returns 201', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.createMessage.mockResolvedValue({ id: 'msg-1', content: 'Hi' });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'user', content: 'Hi' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(201);
    });

    it('rejects empty content without attachments', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'user' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });

    it('rejects invalid role', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'invalid', content: 'Hi' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/spaces/:spaceId/threads/search', () => {
    it('returns 400 when q is missing', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/threads/search'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });

    it('returns search results', async () => {
      mocks.searchSpaceThreads.mockResolvedValue({ threads: [] });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/threads/search?q=hello'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/threads/:id/messages/search', () => {
    it('returns 400 when q is missing', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/messages/search'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/threads/:id/share', () => {
    it('creates a share and returns 201', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.createThreadShare.mockResolvedValue({
        share: { token: 'abc123', mode: 'public' },
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
      expect(json).toHaveProperty('share_url');
    });

    it('rejects invalid expires_in_days', async () => {
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
  });

  describe('GET /api/threads/:id/shares', () => {
    it('returns share list with links', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      });
      mocks.listThreadShares.mockResolvedValue([
        { id: 's-1', token: 'abc123' },
      ]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/shares'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { shares: Array<{ share_path: string; share_url: string }> };
      expect(json.shares[0].share_path).toBe('/share/abc123');
    });
  });

  describe('POST /api/threads/:id/shares/:shareId/revoke', () => {
    it('revokes a share', async () => {
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
  });
});
