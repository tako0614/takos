import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  checkThreadAccess: ((..._args: any[]) => undefined) as any,
  createMessage: ((..._args: any[]) => undefined) as any,
  searchThreadMessages: ((..._args: any[]) => undefined) as any,
  getThreadTimeline: ((..._args: any[]) => undefined) as any,
  getThreadHistory: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-service'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-search'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-timeline'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-history'
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


  let env: Env;
  
    Deno.test('thread-messages routes - GET /api/threads/:id/messages - returns thread timeline messages', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      })) as any;
      mocks.getThreadTimeline = (async () => ({
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello' },
          { id: 'msg-2', role: 'assistant', content: 'Hi there' },
        ],
        total: 2,
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { messages: unknown[]; total: number };
      assertEquals(json.messages.length, 2);
      assertSpyCallArgs(mocks.getThreadTimeline, 0, [
        env,
        'thread-1',
        100,  // default limit
        0,    // default offset
      ]);
})
    Deno.test('thread-messages routes - GET /api/threads/:id/messages - returns 404 when thread not found or access denied', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-missing/messages'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
      assertSpyCalls(mocks.getThreadTimeline, 0);
})
    Deno.test('thread-messages routes - GET /api/threads/:id/messages - passes limit and offset query parameters', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      })) as any;
      mocks.getThreadTimeline = (async () => ({ messages: [], total: 0 })) as any;

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages?limit=50&offset=10'),
        env,
        {} as ExecutionContext,
      );

      assertSpyCallArgs(mocks.getThreadTimeline, 0, [env, 'thread-1', 50, 10]);
})  
  
    Deno.test('thread-messages routes - GET /api/threads/:id/history - returns thread history with messages', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      })) as any;
      mocks.getThreadHistory = (async () => ({
        runs: [{ id: 'run-1', status: 'completed', messages: [] }],
        total: 1,
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/history'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertSpyCallArgs(mocks.getThreadHistory, 0, [env, 'thread-1', {
        limit: 100,
        offset: 0,
        includeMessages: true,
        rootRunId: undefined,
      }]);
})
    Deno.test('thread-messages routes - GET /api/threads/:id/history - returns 404 when thread access denied', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/bad-thread/history'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('thread-messages routes - GET /api/threads/:id/history - passes include_messages=0 to exclude messages', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      })) as any;
      mocks.getThreadHistory = (async () => ({ runs: [], total: 0 })) as any;

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/threads/thread-1/history?include_messages=0'),
        env,
        {} as ExecutionContext,
      );

      assertSpyCallArgs(mocks.getThreadHistory, 0, [env, 'thread-1', {
        limit: 100,
        offset: 0,
        includeMessages: false,
        rootRunId: undefined,
      }]);
})
    Deno.test('thread-messages routes - GET /api/threads/:id/history - passes root_run_id filter', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      })) as any;
      mocks.getThreadHistory = (async () => ({ runs: [], total: 0 })) as any;

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/threads/thread-1/history?root_run_id=run-root-1'),
        env,
        {} as ExecutionContext,
      );

      assertSpyCallArgs(mocks.getThreadHistory, 0, [env, 'thread-1', ({
        rootRunId: 'run-root-1',
      })]);
})  
  
    Deno.test('thread-messages routes - GET /api/threads/:id/messages/search - returns search results', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      })) as any;
      mocks.searchThreadMessages = (async () => ({
        results: [
          { id: 'msg-1', content: 'Contains keyword', score: 0.9 },
        ],
        total: 1,
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages/search?q=keyword'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertSpyCallArgs(mocks.searchThreadMessages, 0, [({
        threadId: 'thread-1',
        query: 'keyword',
        type: 'all',
        limit: 20,
        offset: 0,
      })]);
})
    Deno.test('thread-messages routes - GET /api/threads/:id/messages/search - returns 400 when query is missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages/search'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
      assertSpyCalls(mocks.searchThreadMessages, 0);
})
    Deno.test('thread-messages routes - GET /api/threads/:id/messages/search - returns 400 when query is empty/whitespace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages/search?q=   '),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
})
    Deno.test('thread-messages routes - GET /api/threads/:id/messages/search - returns 404 when thread not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/missing/messages/search?q=test'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('thread-messages routes - GET /api/threads/:id/messages/search - passes search type parameter', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1' },
      })) as any;
      mocks.searchThreadMessages = (async () => ({ results: [], total: 0 })) as any;

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/threads/thread-1/messages/search?q=test&type=semantic'),
        env,
        {} as ExecutionContext,
      );

      assertSpyCallArgs(mocks.searchThreadMessages, 0, [({
        type: 'semantic',
      })]);
})  
  
    Deno.test('thread-messages routes - POST /api/threads/:id/messages - creates a message and returns 201', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1', accountId: 'ws-1' },
      })) as any;
      mocks.createMessage = (async () => ({
        id: 'msg-new',
        role: 'user',
        content: 'New message',
      })) as any;

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

      assertEquals(res.status, 201);
      const json = await res.json() as { message: { id: string } };
      assertEquals(json.message.id, 'msg-new');
})
    Deno.test('thread-messages routes - POST /api/threads/:id/messages - returns 404 when thread not found or not writable', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => null) as any;

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

      assertEquals(res.status, 404);
      assertSpyCalls(mocks.createMessage, 0);
})
    Deno.test('thread-messages routes - POST /api/threads/:id/messages - rejects empty content without attachments', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1', accountId: 'ws-1' },
      })) as any;

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

      assertEquals(res.status, 400);
      const json = await res.json() as { error: string };
      assertStringIncludes(json.error, 'Content is required');
})
    Deno.test('thread-messages routes - POST /api/threads/:id/messages - rejects invalid role', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
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
      assertEquals(res.status, 422);
})
    Deno.test('thread-messages routes - POST /api/threads/:id/messages - accepts tool role with tool_call_id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 'thread-1', space_id: 'ws-1', accountId: 'ws-1' },
      })) as any;
      mocks.createMessage = (async () => ({
        id: 'msg-tool',
        role: 'tool',
        content: '{"result": "ok"}',
        tool_call_id: 'call-1',
      })) as any;

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

      assertEquals(res.status, 201);
})  