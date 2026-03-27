import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  checkThreadAccess: vi.fn(),
  createMessage: vi.fn(),
  searchThreadMessages: vi.fn(),
  getThreadTimeline: vi.fn(),
  getThreadHistory: vi.fn(),
}));

vi.mock('@/services/threads/thread-service', () => ({
  checkThreadAccess: mocks.checkThreadAccess,
  createMessage: mocks.createMessage,
}));

vi.mock('@/services/threads/thread-search', () => ({
  searchThreadMessages: mocks.searchThreadMessages,
}));

vi.mock('@/services/threads/thread-timeline', () => ({
  getThreadTimeline: mocks.getThreadTimeline,
}));

vi.mock('@/services/threads/thread-history', () => ({
  getThreadHistory: mocks.getThreadHistory,
}));

import threadMessagesRoutes from '@/routes/thread-messages';

type BaseVariables = { user: User };

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
  const app = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api', threadMessagesRoutes);
  return app;
}

describe('thread-messages routes', () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    env = createMockEnv() as unknown as Env;
  });

  describe('GET /api/threads/:id/messages', () => {
    it('returns thread timeline messages', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      });
      mocks.getThreadTimeline.mockResolvedValue({
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello' },
          { id: 'msg-2', role: 'assistant', content: 'Hi there' },
        ],
        total: 2,
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { messages: unknown[]; total: number };
      expect(json.messages).toHaveLength(2);
      expect(mocks.getThreadTimeline).toHaveBeenCalledWith(
        env,
        'thread-1',
        100,  // default limit
        0,    // default offset
      );
    });

    it('returns 404 when thread not found or access denied', async () => {
      mocks.checkThreadAccess.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-missing/messages'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
      expect(mocks.getThreadTimeline).not.toHaveBeenCalled();
    });

    it('passes limit and offset query parameters', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      });
      mocks.getThreadTimeline.mockResolvedValue({ messages: [], total: 0 });

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages?limit=50&offset=10'),
        env,
        {} as ExecutionContext,
      );

      expect(mocks.getThreadTimeline).toHaveBeenCalledWith(env, 'thread-1', 50, 10);
    });
  });

  describe('GET /api/threads/:id/history', () => {
    it('returns thread history with messages', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      });
      mocks.getThreadHistory.mockResolvedValue({
        runs: [{ id: 'run-1', status: 'completed', messages: [] }],
        total: 1,
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/history'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(mocks.getThreadHistory).toHaveBeenCalledWith(env, 'thread-1', {
        limit: 100,
        offset: 0,
        includeMessages: true,
        rootRunId: undefined,
      });
    });

    it('returns 404 when thread access denied', async () => {
      mocks.checkThreadAccess.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/bad-thread/history'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('passes include_messages=0 to exclude messages', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      });
      mocks.getThreadHistory.mockResolvedValue({ runs: [], total: 0 });

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/threads/thread-1/history?include_messages=0'),
        env,
        {} as ExecutionContext,
      );

      expect(mocks.getThreadHistory).toHaveBeenCalledWith(env, 'thread-1', {
        limit: 100,
        offset: 0,
        includeMessages: false,
        rootRunId: undefined,
      });
    });

    it('passes root_run_id filter', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      });
      mocks.getThreadHistory.mockResolvedValue({ runs: [], total: 0 });

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/threads/thread-1/history?root_run_id=run-root-1'),
        env,
        {} as ExecutionContext,
      );

      expect(mocks.getThreadHistory).toHaveBeenCalledWith(env, 'thread-1', expect.objectContaining({
        rootRunId: 'run-root-1',
      }));
    });
  });

  describe('GET /api/threads/:id/messages/search', () => {
    it('returns search results', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      });
      mocks.searchThreadMessages.mockResolvedValue({
        results: [
          { id: 'msg-1', content: 'Contains keyword', score: 0.9 },
        ],
        total: 1,
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages/search?q=keyword'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(mocks.searchThreadMessages).toHaveBeenCalledWith(expect.objectContaining({
        threadId: 'thread-1',
        query: 'keyword',
        type: 'all',
        limit: 20,
        offset: 0,
      }));
    });

    it('returns 400 when query is missing', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages/search'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
      expect(mocks.searchThreadMessages).not.toHaveBeenCalled();
    });

    it('returns 400 when query is empty/whitespace', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages/search?q=   '),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });

    it('returns 404 when thread not found', async () => {
      mocks.checkThreadAccess.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/missing/messages/search?q=test'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('passes search type parameter', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      });
      mocks.searchThreadMessages.mockResolvedValue({ results: [], total: 0 });

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages/search?q=test&type=semantic'),
        env,
        {} as ExecutionContext,
      );

      expect(mocks.searchThreadMessages).toHaveBeenCalledWith(expect.objectContaining({
        type: 'semantic',
      }));
    });
  });

  describe('POST /api/threads/:id/messages', () => {
    it('creates a message and returns 201', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1', accountId: 'ws-1' },
      });
      mocks.createMessage.mockResolvedValue({
        id: 'msg-new',
        role: 'user',
        content: 'New message',
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: 'New message',
          }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(201);
      const json = await res.json() as { message: { id: string } };
      expect(json.message.id).toBe('msg-new');
    });

    it('returns 404 when thread not found or not writable', async () => {
      mocks.checkThreadAccess.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/missing/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: 'test',
          }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
      expect(mocks.createMessage).not.toHaveBeenCalled();
    });

    it('rejects empty content without attachments', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1', accountId: 'ws-1' },
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: '',
          }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toContain('Content is required');
    });

    it('rejects invalid role', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'invalid_role',
            content: 'test',
          }),
        }),
        env,
        {} as ExecutionContext,
      );

      // Zod validation rejects invalid enum before route-level handling.
      expect(res.status).toBe(422);
    });

    it('accepts tool role with tool_call_id', async () => {
      mocks.checkThreadAccess.mockResolvedValue({
        thread: { id: 'thread-1', space_id: 'ws-1', accountId: 'ws-1' },
      });
      mocks.createMessage.mockResolvedValue({
        id: 'msg-tool',
        role: 'tool',
        content: '{"result": "ok"}',
        tool_call_id: 'call-1',
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'tool',
            content: '{"result": "ok"}',
            tool_call_id: 'call-1',
          }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(201);
    });
  });
});
