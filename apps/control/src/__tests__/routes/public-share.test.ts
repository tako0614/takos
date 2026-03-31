import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals, assert } from 'jsr:@std/assert';

const mocks = ({
  verifyThreadShareAccess: ((..._args: any[]) => undefined) as any,
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-shares'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/db/schema'
// [Deno] vi.mock removed - manually stub imports from 'drizzle-orm'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/rate-limiter'
import publicShareRoute from '@/routes/public-share';

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Record<string, never> }>();
  app.route('/api/public', publicShareRoute);
  return app;
}

function mockDbForThread(thread: Record<string, unknown> | null, messageRows: unknown[] = []) {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    get: (async () => thread),
    all: (async () => messageRows),
  };
  mocks.getDb = (() => chain) as any;
}


  const env = createMockEnv();
  
    Deno.test('public-share routes - GET /api/public/thread-shares/:token - returns shared thread for public share', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.verifyThreadShareAccess = (async () => ({
        threadId: 't-1',
        share: { mode: 'public', expires_at: null, created_at: '2026-03-01T00:00:00.000Z' },
      })) as any;

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

      assertEquals(res.status, 200);
      const json = await res.json() as Record<string, unknown>;
      assert('share' in json);
      assert('thread' in json);
      assert('messages' in json);
})
    Deno.test('public-share routes - GET /api/public/thread-shares/:token - returns 401 when password is required', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.verifyThreadShareAccess = (async () => ({ error: 'password_required' })) as any;

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/api/public/thread-shares/abc123'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 401);
})
    Deno.test('public-share routes - GET /api/public/thread-shares/:token - returns 404 when share not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.verifyThreadShareAccess = (async () => ({ error: 'not_found' })) as any;

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/api/public/thread-shares/invalid-token'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('public-share routes - GET /api/public/thread-shares/:token - returns 404 when thread is deleted', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.verifyThreadShareAccess = (async () => ({
        threadId: 't-1',
        share: { mode: 'public', expires_at: null, created_at: '2026-03-01T00:00:00.000Z' },
      })) as any;

      mockDbForThread(
        { id: 't-1', title: 'Deleted Thread', status: 'deleted', createdAt: '2026-03-01', updatedAt: '2026-03-01' },
      );

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/api/public/thread-shares/abc123'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})  
  
    Deno.test('public-share routes - POST /api/public/thread-shares/:token/access - returns shared thread with correct password', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.verifyThreadShareAccess = (async () => ({
        threadId: 't-1',
        share: { mode: 'password', expires_at: null, created_at: '2026-03-01T00:00:00.000Z' },
      })) as any;

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

      assertEquals(res.status, 200);
})
    Deno.test('public-share routes - POST /api/public/thread-shares/:token/access - returns 401 when password is required but not provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.verifyThreadShareAccess = (async () => ({ error: 'password_required' })) as any;

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

      assertEquals(res.status, 401);
})
    Deno.test('public-share routes - POST /api/public/thread-shares/:token/access - returns 403 when password is incorrect', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.verifyThreadShareAccess = (async () => ({ error: 'forbidden' })) as any;

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

      assertEquals(res.status, 403);
})  