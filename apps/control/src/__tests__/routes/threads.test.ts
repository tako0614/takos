import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals, assert } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  checkThreadAccess: ((..._args: any[]) => undefined) as any,
  createMessage: ((..._args: any[]) => undefined) as any,
  createThread: ((..._args: any[]) => undefined) as any,
  listThreads: ((..._args: any[]) => undefined) as any,
  updateThread: ((..._args: any[]) => undefined) as any,
  updateThreadStatus: ((..._args: any[]) => undefined) as any,
  createThreadShare: ((..._args: any[]) => undefined) as any,
  listThreadShares: ((..._args: any[]) => undefined) as any,
  revokeThreadShare: ((..._args: any[]) => undefined) as any,
  searchSpaceThreads: ((..._args: any[]) => undefined) as any,
  searchThreadMessages: ((..._args: any[]) => undefined) as any,
  getThreadTimeline: ((..._args: any[]) => undefined) as any,
  getThreadHistory: ((..._args: any[]) => undefined) as any,
  exportThread: ((..._args: any[]) => undefined) as any,
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
  getPlatformServices: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-service'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-shares'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-search'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-timeline'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-history'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-export'
// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
// [Deno] vi.mock removed - manually stub imports from '@/platform/accessors.ts'
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


  const env = createMockEnv();
  
    Deno.test('threads routes - GET /api/spaces/:spaceId/threads - returns threads list', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.listThreads = (async () => [{ id: 't-1', title: 'Test' }]) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/threads'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      await assertEquals(await res.json(), {
        threads: [{ id: 't-1', title: 'Test' }],
      });
})
    Deno.test('threads routes - GET /api/spaces/:spaceId/threads - passes status filter', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.listThreads = (async () => []) as any;

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/threads?status=active'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertSpyCallArgs(mocks.listThreads, 0, [
        env.DB,
        'ws-1',
        { status: 'active' },
      ]);
})  
  
    Deno.test('threads routes - POST /api/spaces/:spaceId/threads - creates a thread and returns 201', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.createThread = (async () => ({ id: 't-new', title: 'New Thread' })) as any;

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

      assertEquals(res.status, 201);
      const json = await res.json() as Record<string, unknown>;
      assert('thread' in json);
})  
  
    Deno.test('threads routes - GET /api/threads/:id - returns thread with access role', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', title: 'Test', space_id: 'ws-1' },
        role: 'owner',
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as Record<string, unknown>;
      assert('thread' in json);
      assert('role' in json); assertEquals((json as any)['role'], 'owner');
})
    Deno.test('threads routes - GET /api/threads/:id - returns 404 when access denied', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-missing'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})  
  
    Deno.test('threads routes - PATCH /api/threads/:id - updates thread title', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.updateThread = (async () => ({ id: 't-1', title: 'Updated' })) as any;

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

      assertEquals(res.status, 200);
})
    Deno.test('threads routes - PATCH /api/threads/:id - returns 400 when no valid updates provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;

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

      assertEquals(res.status, 400);
})
    Deno.test('threads routes - PATCH /api/threads/:id - validates context_window range', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
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

      assertEquals(res.status, 422);
})  
  
    Deno.test('threads routes - DELETE /api/threads/:id - soft-deletes a thread', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.updateThreadStatus = (async () => undefined) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1', { method: 'DELETE' }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      await assertEquals(await res.json(), { success: true });
      assertSpyCallArgs(mocks.updateThreadStatus, 0, [env.DB, 't-1', 'deleted']);
})  
  
    Deno.test('threads routes - POST /api/threads/:id/archive - archives a thread', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.updateThreadStatus = (async () => undefined) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/archive', { method: 'POST' }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertSpyCallArgs(mocks.updateThreadStatus, 0, [env.DB, 't-1', 'archived']);
})  
  
    Deno.test('threads routes - POST /api/threads/:id/unarchive - unarchives a thread', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'editor',
      })) as any;
      mocks.updateThreadStatus = (async () => undefined) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/unarchive', { method: 'POST' }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertSpyCallArgs(mocks.updateThreadStatus, 0, [env.DB, 't-1', 'active']);
})  
  
    Deno.test('threads routes - GET /api/threads/:id/messages - returns timeline messages', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.getThreadTimeline = (async () => ({ messages: [] })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/messages'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
})  
  
    Deno.test('threads routes - POST /api/threads/:id/messages - creates a message and returns 201', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.createMessage = (async () => ({ id: 'msg-1', content: 'Hi' })) as any;

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

      assertEquals(res.status, 201);
})
    Deno.test('threads routes - POST /api/threads/:id/messages - rejects empty content without attachments', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;

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

      assertEquals(res.status, 400);
})
    Deno.test('threads routes - POST /api/threads/:id/messages - rejects invalid role', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
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

      assertEquals(res.status, 422);
})  
  
    Deno.test('threads routes - GET /api/spaces/:spaceId/threads/search - returns 400 when q is missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/threads/search'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
})
    Deno.test('threads routes - GET /api/spaces/:spaceId/threads/search - returns search results', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.searchSpaceThreads = (async () => ({ threads: [] })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/threads/search?q=hello'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
})  
  
    Deno.test('threads routes - GET /api/threads/:id/messages/search - returns 400 when q is missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/messages/search'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
})  
  
    Deno.test('threads routes - POST /api/threads/:id/share - creates a share and returns 201', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.createThreadShare = (async () => ({
        share: { token: 'abc123', mode: 'public' },
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
      assert('share_url' in json);
})
    Deno.test('threads routes - POST /api/threads/:id/share - rejects invalid expires_in_days', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
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
  
    Deno.test('threads routes - GET /api/threads/:id/shares - returns share list with links', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
  mocks.checkThreadAccess = (async () => ({
        thread: { id: 't-1', space_id: 'ws-1' },
        role: 'owner',
      })) as any;
      mocks.listThreadShares = (async () => [
        { id: 's-1', token: 'abc123' },
      ]) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/threads/t-1/shares'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { shares: Array<{ share_path: string; share_url: string }> };
      assertEquals(json.shares[0].share_path, '/share/abc123');
})  
  
    Deno.test('threads routes - POST /api/threads/:id/shares/:shareId/revoke - revokes a share', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
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
    Deno.test('threads routes - POST /api/threads/:id/shares/:shareId/revoke - returns 404 when share not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.getPlatformServices = (() => ({
      documents: { renderPdf: ((..._args: any[]) => undefined) as any },
    })) as any;
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