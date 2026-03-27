import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  listMemories: vi.fn(),
  bumpMemoryAccess: vi.fn(),
  searchMemories: vi.fn(),
  getMemoryById: vi.fn(),
  createMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  listReminders: vi.fn(),
  getReminderById: vi.fn(),
  createReminder: vi.fn(),
  updateReminder: vi.fn(),
  deleteReminder: vi.fn(),
  triggerReminder: vi.fn(),
  requireSpaceAccess: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
}));

vi.mock('@/services/memory', () => ({
  listMemories: mocks.listMemories,
  bumpMemoryAccess: mocks.bumpMemoryAccess,
  searchMemories: mocks.searchMemories,
  getMemoryById: mocks.getMemoryById,
  createMemory: mocks.createMemory,
  updateMemory: mocks.updateMemory,
  deleteMemory: mocks.deleteMemory,
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

vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireSpaceAccess: mocks.requireSpaceAccess,
  };
});

import memoriesRoute from '@/routes/memories';

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
  app.route('/api', memoriesRoute);
  return app;
}

function mockWorkspaceAccess() {
  mocks.requireSpaceAccess.mockResolvedValue({ workspace: { id: 'ws-1' } });
}

describe('memories routes', () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceAccess();
    mocks.bumpMemoryAccess.mockResolvedValue(undefined);
  });

  describe('GET /api/spaces/:spaceId/memories', () => {
    it('returns memories list', async () => {
      const memories = [{ id: 'm-1', content: 'Hello', type: 'episode' }];
      mocks.listMemories.mockResolvedValue(memories);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/memories'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ memories });
    });

    it('returns 404 when workspace access denied', async () => {
      mocks.requireSpaceAccess.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Workspace not found' }), { status: 404 }),
      );

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-bad/memories'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/spaces/:spaceId/memories/search', () => {
    it('returns search results', async () => {
      mocks.searchMemories.mockResolvedValue([{ id: 'm-1', content: 'Match' }]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/memories/search?q=test'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('memories');
    });
  });

  describe('GET /api/memories/:id', () => {
    it('returns a specific memory', async () => {
      const memory = { id: 'm-1', content: 'Hello', space_id: 'ws-1' };
      mocks.getMemoryById.mockResolvedValue(memory);
      mocks.checkWorkspaceAccess.mockResolvedValue(true);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/memories/m-1'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });

    it('returns 404 when memory not found', async () => {
      mocks.getMemoryById.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/memories/m-missing'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 403 when workspace access denied', async () => {
      mocks.getMemoryById.mockResolvedValue({ id: 'm-1', space_id: 'ws-other' });
      mocks.checkWorkspaceAccess.mockResolvedValue(false);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/memories/m-1'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/spaces/:spaceId/memories', () => {
    it('creates a memory and returns 201', async () => {
      const created = { id: 'm-new', content: 'New memory', type: 'episode' };
      mocks.createMemory.mockResolvedValue(created);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/memories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'episode',
            content: 'New memory',
          }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(201);
      expect(mocks.createMemory).toHaveBeenCalled();
    });

    it('rejects invalid type', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/memories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'invalid_type',
            content: 'Hello',
          }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(422);
    });

    it('rejects empty content', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/memories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'episode',
            content: '',
          }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(422);
    });
  });

  describe('PATCH /api/memories/:id', () => {
    it('updates a memory', async () => {
      mocks.getMemoryById.mockResolvedValue({ id: 'm-1', space_id: 'ws-1' });
      mocks.checkWorkspaceAccess.mockResolvedValue(true);
      mocks.updateMemory.mockResolvedValue({ id: 'm-1', content: 'Updated' });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/memories/m-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Updated' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });

    it('returns 404 when memory not found', async () => {
      mocks.getMemoryById.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/memories/m-missing', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Updated' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/memories/:id', () => {
    it('deletes a memory', async () => {
      mocks.getMemoryById.mockResolvedValue({ id: 'm-1', space_id: 'ws-1' });
      mocks.checkWorkspaceAccess.mockResolvedValue(true);
      mocks.deleteMemory.mockResolvedValue(undefined);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/memories/m-1', { method: 'DELETE' }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ success: true });
    });
  });

  describe('Reminders', () => {
    describe('GET /api/spaces/:spaceId/reminders', () => {
      it('returns reminders list', async () => {
        mocks.listReminders.mockResolvedValue([{ id: 'r-1', content: 'Test' }]);

        const app = createApp(createUser());
        const res = await app.fetch(
          new Request('http://localhost/api/spaces/sp-1/reminders'),
          env as unknown as Env,
          {} as ExecutionContext,
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ reminders: [{ id: 'r-1', content: 'Test' }] });
      });
    });

    describe('GET /api/reminders/:id', () => {
      it('returns 404 for non-existent reminder', async () => {
        mocks.getReminderById.mockResolvedValue(null);

        const app = createApp(createUser());
        const res = await app.fetch(
          new Request('http://localhost/api/reminders/r-missing'),
          env as unknown as Env,
          {} as ExecutionContext,
        );

        expect(res.status).toBe(404);
      });

      it('returns 403 when workspace access denied', async () => {
        mocks.getReminderById.mockResolvedValue({ id: 'r-1', space_id: 'ws-other' });
        mocks.checkWorkspaceAccess.mockResolvedValue(false);

        const app = createApp(createUser());
        const res = await app.fetch(
          new Request('http://localhost/api/reminders/r-1'),
          env as unknown as Env,
          {} as ExecutionContext,
        );

        expect(res.status).toBe(403);
      });
    });

    describe('POST /api/spaces/:spaceId/reminders', () => {
      it('creates a reminder and returns 201', async () => {
        mocks.createReminder.mockResolvedValue({ id: 'r-new', content: 'Reminder' });

        const app = createApp(createUser());
        const res = await app.fetch(
          new Request('http://localhost/api/spaces/sp-1/reminders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: 'Reminder',
              trigger_type: 'time',
            }),
          }),
          env as unknown as Env,
          {} as ExecutionContext,
        );

        expect(res.status).toBe(201);
      });

      it('rejects invalid trigger_type', async () => {
        const app = createApp(createUser());
        const res = await app.fetch(
          new Request('http://localhost/api/spaces/sp-1/reminders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: 'Reminder',
              trigger_type: 'invalid',
            }),
          }),
          env as unknown as Env,
          {} as ExecutionContext,
        );

        expect(res.status).toBe(422);
      });

      it('rejects empty content', async () => {
        const app = createApp(createUser());
        const res = await app.fetch(
          new Request('http://localhost/api/spaces/sp-1/reminders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: '',
              trigger_type: 'time',
            }),
          }),
          env as unknown as Env,
          {} as ExecutionContext,
        );

        expect(res.status).toBe(422);
      });
    });

    describe('PATCH /api/reminders/:id', () => {
      it('updates a reminder', async () => {
        mocks.getReminderById.mockResolvedValue({ id: 'r-1', space_id: 'ws-1' });
        mocks.checkWorkspaceAccess.mockResolvedValue(true);
        mocks.updateReminder.mockResolvedValue({ id: 'r-1', content: 'Updated' });

        const app = createApp(createUser());
        const res = await app.fetch(
          new Request('http://localhost/api/reminders/r-1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: 'Updated' }),
          }),
          env as unknown as Env,
          {} as ExecutionContext,
        );

        expect(res.status).toBe(200);
      });
    });

    describe('DELETE /api/reminders/:id', () => {
      it('deletes a reminder', async () => {
        mocks.getReminderById.mockResolvedValue({ id: 'r-1', space_id: 'ws-1' });
        mocks.checkWorkspaceAccess.mockResolvedValue(true);
        mocks.deleteReminder.mockResolvedValue(undefined);

        const app = createApp(createUser());
        const res = await app.fetch(
          new Request('http://localhost/api/reminders/r-1', { method: 'DELETE' }),
          env as unknown as Env,
          {} as ExecutionContext,
        );

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ success: true });
      });
    });

    describe('POST /api/reminders/:id/trigger', () => {
      it('triggers a reminder manually', async () => {
        mocks.getReminderById.mockResolvedValue({ id: 'r-1', space_id: 'ws-1' });
        mocks.checkWorkspaceAccess.mockResolvedValue(true);
        mocks.triggerReminder.mockResolvedValue({ id: 'r-1', status: 'triggered' });

        const app = createApp(createUser());
        const res = await app.fetch(
          new Request('http://localhost/api/reminders/r-1/trigger', {
            method: 'POST',
          }),
          env as unknown as Env,
          {} as ExecutionContext,
        );

        expect(res.status).toBe(200);
      });
    });
  });
});
