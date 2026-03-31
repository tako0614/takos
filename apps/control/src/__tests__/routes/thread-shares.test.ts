import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals, assert } from 'jsr:@std/assert';

const mocks = ({
  checkThreadAccess: ((..._args: any[]) => undefined) as any,
  createThreadShare: ((..._args: any[]) => undefined) as any,
  listThreadShares: ((..._args: any[]) => undefined) as any,
  revokeThreadShare: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-service'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-shares'
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


  const env = createMockEnv();
  
    Deno.test('thread-shares routes - POST /api/threads/:id/share - creates a public share and returns 201', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.createThreadShare = (async () => ({
        share: { token: 'token123', mode: 'public' },
        passwordRequired: false,
      })) as any;

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

      assertEquals(res.status, 201);
      const json = await res.json() as Record<string, unknown>;
      assert('share' in json);
      assert('share_path' in json); assertEquals((json as any)['share_path'], '/share/token123');
      assert('share_url' in json);
      assertEquals(json.password_required, false);
})
    Deno.test('thread-shares routes - POST /api/threads/:id/share - creates a password-protected share', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.createThreadShare = (async () => ({
        share: { token: 'token456', mode: 'password' },
        passwordRequired: true,
      })) as any;

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

      assertEquals(res.status, 201);
      const json = await res.json() as Record<string, unknown>;
      assertEquals(json.password_required, true);
})
    Deno.test('thread-shares routes - POST /api/threads/:id/share - returns 404 when thread not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.checkThreadAccess = (async () => null) as any;

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

      assertEquals(res.status, 404);
})
    Deno.test('thread-shares routes - POST /api/threads/:id/share - rejects expires_in_days > 365', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;

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

      assertEquals(res.status, 400);
})
    Deno.test('thread-shares routes - POST /api/threads/:id/share - rejects expires_in_days <= 0', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;

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

      assertEquals(res.status, 400);
})
    Deno.test('thread-shares routes - POST /api/threads/:id/share - returns 400 when createThreadShare throws', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.createThreadShare = (async () => { throw new Error('Share creation failed'); }) as any;

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

      assertEquals(res.status, 400);
})  
  
    Deno.test('thread-shares routes - GET /api/threads/:id/shares - returns list of shares with URLs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.listThreadShares = (async () => [
        { id: 's-1', token: 'abc', mode: 'public' },
        { id: 's-2', token: 'def', mode: 'password' },
      ]) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/shares'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { shares: Array<{ share_path: string; share_url: string }> };
      assertEquals(json.shares.length, 2);
      assertEquals(json.shares[0].share_path, '/share/abc');
      assertEquals(json.shares[1].share_path, '/share/def');
})
    Deno.test('thread-shares routes - GET /api/threads/:id/shares - returns 404 when thread not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.checkThreadAccess = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-missing/shares'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})  
  
    Deno.test('thread-shares routes - POST /api/threads/:id/shares/:shareId/revoke - revokes a share successfully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.revokeThreadShare = (async () => true) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/shares/s-1/revoke', {
          method: 'POST',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      await assertEquals(await res.json(), { success: true });
})
    Deno.test('thread-shares routes - POST /api/threads/:id/shares/:shareId/revoke - returns 404 when share not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.revokeThreadShare = (async () => false) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/shares/s-missing/revoke', {
          method: 'POST',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('thread-shares routes - POST /api/threads/:id/shares/:shareId/revoke - returns 404 when thread not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.checkThreadAccess = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-missing/shares/s-1/revoke', {
          method: 'POST',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})  