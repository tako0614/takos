import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
  listReminders: ((..._args: any[]) => undefined) as any,
  getReminderById: ((..._args: any[]) => undefined) as any,
  createReminder: ((..._args: any[]) => undefined) as any,
  updateReminder: ((..._args: any[]) => undefined) as any,
  deleteReminder: ((..._args: any[]) => undefined) as any,
  triggerReminder: ((..._args: any[]) => undefined) as any,
  checkWorkspaceAccess: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
// [Deno] vi.mock removed - manually stub imports from '@/services/memory'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import remindersRoutes from '@/routes/reminders';

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
  app.route('/api', remindersRoutes);
  return app;
}


  let env: Env;
  
    Deno.test('reminders routes - GET /api/spaces/:spaceId/reminders - returns reminders list for a workspace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
        workspace: { id: 'ws-1' },
        member: { role: 'owner' },
      })) as any;
      mocks.listReminders = (async () => [
        { id: 'rem-1', content: 'Do something', status: 'pending' },
      ]) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/ws-1/reminders'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { reminders: unknown[] };
      assertEquals(json.reminders.length, 1);
      assertSpyCallArgs(mocks.listReminders, 0, [
        env.DB,
        'ws-1',
        ({ limit: 50 }),
      ]);
})
    Deno.test('reminders routes - GET /api/spaces/:spaceId/reminders - returns error when workspace access is denied', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => new Response(JSON.stringify({ error: 'Workspace not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/ws-bad/reminders'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
      assertSpyCalls(mocks.listReminders, 0);
})
    Deno.test('reminders routes - GET /api/spaces/:spaceId/reminders - passes status filter and limit to service', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
        workspace: { id: 'ws-1' },
        member: { role: 'viewer' },
      })) as any;
      mocks.listReminders = (async () => []) as any;

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/spaces/ws-1/reminders?status=triggered&limit=10'),
        env,
        {} as ExecutionContext,
      );

      assertSpyCallArgs(mocks.listReminders, 0, [
        env.DB,
        'ws-1',
        { status: 'triggered', limit: 10 },
      ]);
})  
  
    Deno.test('reminders routes - GET /api/reminders/:id - returns a specific reminder', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => ({
        id: 'rem-1',
        space_id: 'ws-1',
        content: 'Check logs',
        status: 'pending',
      })) as any;
      mocks.checkWorkspaceAccess = (async () => ({
        member: { role: 'viewer' },
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { id: string; content: string };
      assertEquals(json.id, 'rem-1');
})
    Deno.test('reminders routes - GET /api/reminders/:id - returns 404 when reminder not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-missing'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('reminders routes - GET /api/reminders/:id - returns 403 when user has no workspace access', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => ({
        id: 'rem-1',
        space_id: 'ws-other',
      })) as any;
      mocks.checkWorkspaceAccess = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 403);
})  
  
    Deno.test('reminders routes - POST /api/spaces/:spaceId/reminders - creates a reminder and returns 201', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
        workspace: { id: 'ws-1' },
        member: { role: 'editor' },
      })) as any;
      mocks.createReminder = (async () => ({
        id: 'rem-new',
        content: 'Deploy v2',
        trigger_type: 'time',
        status: 'pending',
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/ws-1/reminders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: 'Deploy v2',
            trigger_type: 'time',
            trigger_value: '2026-04-01T00:00:00Z',
          }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 201);
      assertSpyCallArgs(mocks.createReminder, 0, [
        env.DB,
        ({
          spaceId: 'ws-1',
          userId: 'user-1',
          content: 'Deploy v2',
          triggerType: 'time',
        }),
      ]);
})
    Deno.test('reminders routes - POST /api/spaces/:spaceId/reminders - rejects empty content', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
        workspace: { id: 'ws-1' },
        member: { role: 'editor' },
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/ws-1/reminders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: '',
            trigger_type: 'time',
          }),
        }),
        env,
        {} as ExecutionContext,
      );

      // Zod validation should reject empty content (min 1)
      assertEquals(res.status, 422);
      assertSpyCalls(mocks.createReminder, 0);
})
    Deno.test('reminders routes - POST /api/spaces/:spaceId/reminders - rejects invalid trigger_type', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
        workspace: { id: 'ws-1' },
        member: { role: 'editor' },
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/ws-1/reminders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: 'Valid content',
            trigger_type: 'invalid_type',
          }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 422);
})  
  
    Deno.test('reminders routes - PATCH /api/reminders/:id - updates a reminder', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => ({
        id: 'rem-1',
        space_id: 'ws-1',
      })) as any;
      mocks.checkWorkspaceAccess = (async () => ({
        member: { role: 'editor' },
      })) as any;
      mocks.updateReminder = (async () => ({
        id: 'rem-1',
        content: 'Updated content',
        status: 'pending',
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Updated content' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertSpyCallArgs(mocks.updateReminder, 0, [
        env.DB,
        'rem-1',
        ({ content: 'Updated content' }),
      ]);
})
    Deno.test('reminders routes - PATCH /api/reminders/:id - returns 404 when reminder not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-gone', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('reminders routes - PATCH /api/reminders/:id - returns 403 for insufficient permissions', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => ({
        id: 'rem-1',
        space_id: 'ws-1',
      })) as any;
      mocks.checkWorkspaceAccess = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 403);
})
    Deno.test('reminders routes - PATCH /api/reminders/:id - rejects invalid status values', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => ({
        id: 'rem-1',
        space_id: 'ws-1',
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'invalid_status' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 422);
})  
  
    Deno.test('reminders routes - DELETE /api/reminders/:id - deletes a reminder', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => ({
        id: 'rem-1',
        space_id: 'ws-1',
      })) as any;
      mocks.checkWorkspaceAccess = (async () => ({
        member: { role: 'admin' },
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { success: boolean };
      assertEquals(json.success, true);
      assertSpyCallArgs(mocks.deleteReminder, 0, [env.DB, 'rem-1']);
})
    Deno.test('reminders routes - DELETE /api/reminders/:id - returns 404 when reminder not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-gone', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('reminders routes - DELETE /api/reminders/:id - returns 403 for insufficient permissions', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => ({
        id: 'rem-1',
        space_id: 'ws-1',
      })) as any;
      mocks.checkWorkspaceAccess = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 403);
})  
  
    Deno.test('reminders routes - POST /api/reminders/:id/trigger - manually triggers a reminder', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => ({
        id: 'rem-1',
        space_id: 'ws-1',
      })) as any;
      mocks.checkWorkspaceAccess = (async () => ({
        member: { role: 'editor' },
      })) as any;
      mocks.triggerReminder = (async () => ({
        id: 'rem-1',
        status: 'triggered',
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1/trigger', { method: 'POST' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertSpyCallArgs(mocks.triggerReminder, 0, [env.DB, 'rem-1']);
})
    Deno.test('reminders routes - POST /api/reminders/:id/trigger - returns 404 when reminder not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-gone/trigger', { method: 'POST' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('reminders routes - POST /api/reminders/:id/trigger - returns 403 for insufficient permissions', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => ({
        id: 'rem-1',
        space_id: 'ws-1',
      })) as any;
      mocks.checkWorkspaceAccess = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1/trigger', { method: 'POST' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 403);
})  