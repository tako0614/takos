import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  getNotificationsMutedUntil: vi.fn(),
  setNotificationsMutedUntil: vi.fn(),
  isNotificationType: vi.fn(),
  isNotificationChannel: vi.fn(),
}));

vi.mock('@/services/notifications', () => ({
  listNotifications: mocks.listNotifications,
  getUnreadCount: mocks.getUnreadCount,
  markNotificationRead: mocks.markNotificationRead,
  getNotificationPreferences: mocks.getNotificationPreferences,
  updateNotificationPreferences: mocks.updateNotificationPreferences,
  getNotificationsMutedUntil: mocks.getNotificationsMutedUntil,
  setNotificationsMutedUntil: mocks.setNotificationsMutedUntil,
}));

vi.mock('@/services/notifications/types', () => ({
  isNotificationType: mocks.isNotificationType,
  isNotificationChannel: mocks.isNotificationChannel,
  NOTIFICATION_TYPES: ['run_complete', 'mention'],
  NOTIFICATION_CHANNELS: ['in_app', 'email'],
}));

vi.mock('@/durable-objects/shared', () => ({
  buildSanitizedDOHeaders: vi.fn((_headers: Headers, extra: Record<string, string>) => {
    const h = new Headers();
    for (const [k, v] of Object.entries(extra)) h.set(k, v);
    return h;
  }),
}));

import notificationsRoute from '@/routes/notifications';

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
  app.route('/api', notificationsRoute);
  return app;
}

describe('notifications routes', () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/notifications', () => {
    it('returns notifications list', async () => {
      const notifications = [{ id: 'n-1', type: 'run_complete', read: false }];
      mocks.listNotifications.mockResolvedValue(notifications);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual(notifications);
      expect(mocks.listNotifications).toHaveBeenCalledWith(
        env.DB,
        'user-1',
        { limit: undefined, before: null },
      );
    });

    it('passes limit and before query params', async () => {
      mocks.listNotifications.mockResolvedValue([]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications?limit=10&before=2026-03-01T00:00:00.000Z'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(mocks.listNotifications).toHaveBeenCalledWith(
        env.DB,
        'user-1',
        { limit: 10, before: '2026-03-01T00:00:00.000Z' },
      );
    });

    it('rejects invalid before parameter', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications?before=not-a-date'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('returns unread count', async () => {
      mocks.getUnreadCount.mockResolvedValue(5);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/unread-count'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ unread_count: 5 });
    });
  });

  describe('PATCH /api/notifications/:id/read', () => {
    it('marks notification as read', async () => {
      mocks.markNotificationRead.mockResolvedValue({ success: true });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/n-1/read', {
          method: 'PATCH',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(mocks.markNotificationRead).toHaveBeenCalledWith(env.DB, 'user-1', 'n-1');
    });
  });

  describe('GET /api/notifications/preferences', () => {
    it('returns preference list with types and channels', async () => {
      mocks.getNotificationPreferences.mockResolvedValue([]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/preferences'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('types');
      expect(json).toHaveProperty('channels');
      expect(json).toHaveProperty('preferences');
    });
  });

  describe('PATCH /api/notifications/preferences', () => {
    it('updates preferences with valid input', async () => {
      mocks.isNotificationType.mockReturnValue(true);
      mocks.isNotificationChannel.mockReturnValue(true);
      mocks.updateNotificationPreferences.mockResolvedValue([]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            updates: [{ type: 'run_complete', channel: 'in_app', enabled: false }],
          }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(mocks.updateNotificationPreferences).toHaveBeenCalled();
    });

    it('rejects invalid notification type', async () => {
      mocks.isNotificationType.mockReturnValue(false);
      mocks.isNotificationChannel.mockReturnValue(true);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            updates: [{ type: 'invalid_type', channel: 'in_app', enabled: false }],
          }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });

    it('rejects invalid notification channel', async () => {
      mocks.isNotificationType.mockReturnValue(true);
      mocks.isNotificationChannel.mockReturnValue(false);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            updates: [{ type: 'run_complete', channel: 'invalid_channel', enabled: false }],
          }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });

    it('rejects request without updates array', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/notifications/settings', () => {
    it('returns muted_until setting', async () => {
      mocks.getNotificationsMutedUntil.mockResolvedValue('2026-04-01T00:00:00.000Z');

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/settings'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        muted_until: '2026-04-01T00:00:00.000Z',
      });
    });
  });

  describe('PATCH /api/notifications/settings', () => {
    it('updates muted_until with valid datetime', async () => {
      mocks.setNotificationsMutedUntil.mockResolvedValue({ muted_until: '2026-04-01T00:00:00.000Z' });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ muted_until: '2026-04-01T00:00:00.000Z' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });

    it('allows null muted_until to unmute', async () => {
      mocks.setNotificationsMutedUntil.mockResolvedValue({ muted_until: null });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ muted_until: null }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
    });

    it('rejects invalid datetime for muted_until', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ muted_until: 'not-a-date' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/notifications/ws', () => {
    it('returns 426 without Upgrade: websocket header', async () => {
      const app = createApp(createUser());
      const envWithNotifier = createMockEnv({
        NOTIFICATION_NOTIFIER: {
          idFromName: vi.fn(() => 'id-1'),
          get: vi.fn(() => ({ fetch: vi.fn() })),
        },
      });

      const res = await app.fetch(
        new Request('http://localhost/api/notifications/ws'),
        envWithNotifier as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(426);
    });

    it('returns 500 when NOTIFICATION_NOTIFIER is not configured', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/notifications/ws', {
          headers: { Upgrade: 'websocket' },
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(500);
    });
  });
});
