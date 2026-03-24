import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  requireWorkspaceAccess: vi.fn(),
  listReminders: vi.fn(),
  getReminderById: vi.fn(),
  createReminder: vi.fn(),
  updateReminder: vi.fn(),
  deleteReminder: vi.fn(),
  triggerReminder: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
}));

vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireWorkspaceAccess: mocks.requireWorkspaceAccess,
  };
});

vi.mock('@/services/memory', () => ({
  listReminders: mocks.listReminders,
  getReminderById: mocks.getReminderById,
  createReminder: mocks.createReminder,
  updateReminder: mocks.updateReminder,
  deleteReminder: mocks.deleteReminder,
  triggerReminder: mocks.triggerReminder,
}));

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils')>();
  return {
    ...actual,
    checkWorkspaceAccess: mocks.checkWorkspaceAccess,
  };
});

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

describe('reminders routes', () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    env = createMockEnv() as unknown as Env;
  });

  describe('GET /api/spaces/:spaceId/reminders', () => {
    it('returns reminders list for a workspace', async () => {
      mocks.requireWorkspaceAccess.mockResolvedValue({
        workspace: { id: 'ws-1' },
        member: { role: 'owner' },
      });
      mocks.listReminders.mockResolvedValue([
        { id: 'rem-1', content: 'Do something', status: 'pending' },
      ]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/ws-1/reminders'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { reminders: unknown[] };
      expect(json.reminders).toHaveLength(1);
      expect(mocks.listReminders).toHaveBeenCalledWith(
        env.DB,
        'ws-1',
        expect.objectContaining({ limit: 50 }),
      );
    });

    it('returns error when workspace access is denied', async () => {
      mocks.requireWorkspaceAccess.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Workspace not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/ws-bad/reminders'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
      expect(mocks.listReminders).not.toHaveBeenCalled();
    });

    it('passes status filter and limit to service', async () => {
      mocks.requireWorkspaceAccess.mockResolvedValue({
        workspace: { id: 'ws-1' },
        member: { role: 'viewer' },
      });
      mocks.listReminders.mockResolvedValue([]);

      const app = createApp(createUser());
      await app.fetch(
        new Request('http://localhost/api/spaces/ws-1/reminders?status=triggered&limit=10'),
        env,
        {} as ExecutionContext,
      );

      expect(mocks.listReminders).toHaveBeenCalledWith(
        env.DB,
        'ws-1',
        { status: 'triggered', limit: 10 },
      );
    });
  });

  describe('GET /api/reminders/:id', () => {
    it('returns a specific reminder', async () => {
      mocks.getReminderById.mockResolvedValue({
        id: 'rem-1',
        space_id: 'ws-1',
        content: 'Check logs',
        status: 'pending',
      });
      mocks.checkWorkspaceAccess.mockResolvedValue({
        member: { role: 'viewer' },
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { id: string; content: string };
      expect(json.id).toBe('rem-1');
    });

    it('returns 404 when reminder not found', async () => {
      mocks.getReminderById.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-missing'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 403 when user has no workspace access', async () => {
      mocks.getReminderById.mockResolvedValue({
        id: 'rem-1',
        space_id: 'ws-other',
      });
      mocks.checkWorkspaceAccess.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/spaces/:spaceId/reminders', () => {
    it('creates a reminder and returns 201', async () => {
      mocks.requireWorkspaceAccess.mockResolvedValue({
        workspace: { id: 'ws-1' },
        member: { role: 'editor' },
      });
      mocks.createReminder.mockResolvedValue({
        id: 'rem-new',
        content: 'Deploy v2',
        trigger_type: 'time',
        status: 'pending',
      });

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

      expect(res.status).toBe(201);
      expect(mocks.createReminder).toHaveBeenCalledWith(
        env.DB,
        expect.objectContaining({
          spaceId: 'ws-1',
          userId: 'user-1',
          content: 'Deploy v2',
          triggerType: 'time',
        }),
      );
    });

    it('rejects empty content', async () => {
      mocks.requireWorkspaceAccess.mockResolvedValue({
        workspace: { id: 'ws-1' },
        member: { role: 'editor' },
      });

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
      expect(res.status).toBe(422);
      expect(mocks.createReminder).not.toHaveBeenCalled();
    });

    it('rejects invalid trigger_type', async () => {
      mocks.requireWorkspaceAccess.mockResolvedValue({
        workspace: { id: 'ws-1' },
        member: { role: 'editor' },
      });

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

      expect(res.status).toBe(422);
    });
  });

  describe('PATCH /api/reminders/:id', () => {
    it('updates a reminder', async () => {
      mocks.getReminderById.mockResolvedValue({
        id: 'rem-1',
        space_id: 'ws-1',
      });
      mocks.checkWorkspaceAccess.mockResolvedValue({
        member: { role: 'editor' },
      });
      mocks.updateReminder.mockResolvedValue({
        id: 'rem-1',
        content: 'Updated content',
        status: 'pending',
      });

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

      expect(res.status).toBe(200);
      expect(mocks.updateReminder).toHaveBeenCalledWith(
        env.DB,
        'rem-1',
        expect.objectContaining({ content: 'Updated content' }),
      );
    });

    it('returns 404 when reminder not found', async () => {
      mocks.getReminderById.mockResolvedValue(null);

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

      expect(res.status).toBe(404);
    });

    it('returns 403 for insufficient permissions', async () => {
      mocks.getReminderById.mockResolvedValue({
        id: 'rem-1',
        space_id: 'ws-1',
      });
      mocks.checkWorkspaceAccess.mockResolvedValue(null);

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

      expect(res.status).toBe(403);
    });

    it('rejects invalid status values', async () => {
      mocks.getReminderById.mockResolvedValue({
        id: 'rem-1',
        space_id: 'ws-1',
      });

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

      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /api/reminders/:id', () => {
    it('deletes a reminder', async () => {
      mocks.getReminderById.mockResolvedValue({
        id: 'rem-1',
        space_id: 'ws-1',
      });
      mocks.checkWorkspaceAccess.mockResolvedValue({
        member: { role: 'admin' },
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { success: boolean };
      expect(json.success).toBe(true);
      expect(mocks.deleteReminder).toHaveBeenCalledWith(env.DB, 'rem-1');
    });

    it('returns 404 when reminder not found', async () => {
      mocks.getReminderById.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-gone', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 403 for insufficient permissions', async () => {
      mocks.getReminderById.mockResolvedValue({
        id: 'rem-1',
        space_id: 'ws-1',
      });
      mocks.checkWorkspaceAccess.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/reminders/:id/trigger', () => {
    it('manually triggers a reminder', async () => {
      mocks.getReminderById.mockResolvedValue({
        id: 'rem-1',
        space_id: 'ws-1',
      });
      mocks.checkWorkspaceAccess.mockResolvedValue({
        member: { role: 'editor' },
      });
      mocks.triggerReminder.mockResolvedValue({
        id: 'rem-1',
        status: 'triggered',
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1/trigger', { method: 'POST' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(mocks.triggerReminder).toHaveBeenCalledWith(env.DB, 'rem-1');
    });

    it('returns 404 when reminder not found', async () => {
      mocks.getReminderById.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-gone/trigger', { method: 'POST' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 403 for insufficient permissions', async () => {
      mocks.getReminderById.mockResolvedValue({
        id: 'rem-1',
        space_id: 'ws-1',
      });
      mocks.checkWorkspaceAccess.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/reminders/rem-1/trigger', { method: 'POST' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
    });
  });
});
