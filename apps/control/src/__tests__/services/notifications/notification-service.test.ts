import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn().mockReturnValue('notif-id-1'),
  now: vi.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils')>()),
  generateId: mocks.generateId,
  now: mocks.now,
}));

import {
  ensureNotificationSettings,
  getNotificationsMutedUntil,
  isNotificationsMuted,
  setNotificationsMutedUntil,
  ensureNotificationPreferences,
  getNotificationPreferences,
  updateNotificationPreferences,
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  createNotification,
  updateNotificationPreferencesSchema,
  setMutedUntilSchema,
  listNotificationsQuerySchema,
} from '@/services/notifications/notification-service';

import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from '@/services/notifications/types';

import type { Env } from '@/types';

function makeChain(overrides: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = {};
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockReturnValue(c);
  c.get = vi.fn().mockResolvedValue(null);
  c.all = vi.fn().mockResolvedValue([]);
  c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
  c.returning = vi.fn().mockReturnValue(c);
  Object.assign(c, overrides);
  return c;
}

function makeDrizzle() {
  return {
    select: vi.fn().mockImplementation(() => makeChain()),
    insert: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.values = vi.fn().mockReturnValue(c);
      c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      c.returning = vi.fn().mockReturnValue(c);
      c.get = vi.fn().mockResolvedValue(null);
      return c;
    }),
    update: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.set = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      c.returning = vi.fn().mockReturnValue(c);
      c.get = vi.fn().mockResolvedValue(null);
      return c;
    }),
    delete: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.where = vi.fn().mockReturnValue(c);
      c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      return c;
    }),
  };
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

describe('updateNotificationPreferencesSchema', () => {
  it('accepts valid updates', () => {
    const result = updateNotificationPreferencesSchema.safeParse({
      updates: [{ type: 'run.completed', channel: 'in_app', enabled: true }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty updates array', () => {
    const result = updateNotificationPreferencesSchema.safeParse({ updates: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid notification type', () => {
    const result = updateNotificationPreferencesSchema.safeParse({
      updates: [{ type: 'invalid.type', channel: 'in_app', enabled: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid channel', () => {
    const result = updateNotificationPreferencesSchema.safeParse({
      updates: [{ type: 'run.completed', channel: 'sms', enabled: true }],
    });
    expect(result.success).toBe(false);
  });
});

describe('setMutedUntilSchema', () => {
  it('accepts valid datetime string', () => {
    const result = setMutedUntilSchema.safeParse({ muted_until: '2025-12-31T23:59:59Z' });
    expect(result.success).toBe(true);
  });

  it('accepts null', () => {
    const result = setMutedUntilSchema.safeParse({ muted_until: null });
    expect(result.success).toBe(true);
  });

  it('rejects invalid datetime string', () => {
    const result = setMutedUntilSchema.safeParse({ muted_until: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});

describe('listNotificationsQuerySchema', () => {
  it('accepts valid limit and before', () => {
    const result = listNotificationsQuerySchema.safeParse({
      limit: 10,
      before: '2025-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects limit over 50', () => {
    const result = listNotificationsQuerySchema.safeParse({ limit: 100 });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive limit', () => {
    const result = listNotificationsQuerySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ensureNotificationSettings
// ---------------------------------------------------------------------------

describe('ensureNotificationSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts settings when none exist', async () => {
    const drizzle = makeDrizzle();
    mocks.getDb.mockReturnValue(drizzle);

    await ensureNotificationSettings({} as never, 'user-1');

    expect(drizzle.select).toHaveBeenCalled();
    expect(drizzle.insert).toHaveBeenCalled();
  });

  it('does not insert when settings already exist', async () => {
    const selectChain = makeChain({
      get: vi.fn().mockResolvedValue({ accountId: 'user-1' }),
    });
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockReturnValue(selectChain);
    mocks.getDb.mockReturnValue(drizzle);

    await ensureNotificationSettings({} as never, 'user-1');

    expect(drizzle.insert).not.toHaveBeenCalled();
  });

  it('throws descriptive error when table is missing', async () => {
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockImplementation(() => {
      throw new Error('no such table: notification_settings');
    });
    mocks.getDb.mockReturnValue(drizzle);

    await expect(ensureNotificationSettings({} as never, 'user-1')).rejects.toThrow(
      'Required table',
    );
  });
});

// ---------------------------------------------------------------------------
// getNotificationsMutedUntil / isNotificationsMuted
// ---------------------------------------------------------------------------

describe('getNotificationsMutedUntil', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no settings row found', async () => {
    const drizzle = makeDrizzle();
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getNotificationsMutedUntil({} as never, 'user-1');
    expect(result).toBeNull();
  });

  it('returns muted_until value when set', async () => {
    const selectChain = makeChain({
      get: vi.fn().mockResolvedValue({ mutedUntil: '2025-12-31T23:59:59Z' }),
    });
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockReturnValue(selectChain);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getNotificationsMutedUntil({} as never, 'user-1');
    expect(result).toBe('2025-12-31T23:59:59Z');
  });
});

describe('isNotificationsMuted', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when no muted_until is set', async () => {
    const drizzle = makeDrizzle();
    mocks.getDb.mockReturnValue(drizzle);

    const result = await isNotificationsMuted({} as never, 'user-1');
    expect(result).toBe(false);
  });

  it('returns true when muted_until is in the future', async () => {
    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    const selectChain = makeChain({
      get: vi.fn().mockResolvedValue({ mutedUntil: futureDate }),
    });
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockReturnValue(selectChain);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await isNotificationsMuted({} as never, 'user-1');
    expect(result).toBe(true);
  });

  it('returns false when muted_until is in the past', async () => {
    const pastDate = new Date(Date.now() - 3600_000).toISOString();
    const selectChain = makeChain({
      get: vi.fn().mockResolvedValue({ mutedUntil: pastDate }),
    });
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockReturnValue(selectChain);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await isNotificationsMuted({} as never, 'user-1');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setNotificationsMutedUntil
// ---------------------------------------------------------------------------

describe('setNotificationsMutedUntil', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates existing settings row', async () => {
    const selectChain = makeChain({
      get: vi.fn().mockResolvedValue({ mutedUntil: null }),
    });
    const updateChain = makeChain({
      get: vi.fn().mockResolvedValue({ mutedUntil: '2025-06-01T00:00:00.000Z' }),
    });
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockReturnValue(selectChain);
    drizzle.update = vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.set = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.returning = vi.fn().mockReturnValue(c);
      c.get = vi.fn().mockResolvedValue({ mutedUntil: '2025-06-01T00:00:00.000Z' });
      return c;
    });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await setNotificationsMutedUntil({} as never, 'user-1', '2025-06-01T00:00:00Z');
    expect(result.muted_until).toBe('2025-06-01T00:00:00.000Z');
  });

  it('clears muted_until when null is passed', async () => {
    const selectChain = makeChain({
      get: vi.fn().mockResolvedValue({ mutedUntil: '2025-06-01T00:00:00Z' }),
    });
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockReturnValue(selectChain);
    drizzle.update = vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.set = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.returning = vi.fn().mockReturnValue(c);
      c.get = vi.fn().mockResolvedValue({ mutedUntil: null });
      return c;
    });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await setNotificationsMutedUntil({} as never, 'user-1', null);
    expect(result.muted_until).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getNotificationPreferences / ensureNotificationPreferences
// ---------------------------------------------------------------------------

describe('getNotificationPreferences', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns default preferences when no rows exist', async () => {
    const drizzle = makeDrizzle();
    // All selects return empty (no existing preferences)
    mocks.getDb.mockReturnValue(drizzle);

    const prefs = await getNotificationPreferences({} as never, 'user-1');

    // Check that all types and channels are present
    for (const type of NOTIFICATION_TYPES) {
      expect(prefs[type]).toBeDefined();
      for (const channel of NOTIFICATION_CHANNELS) {
        expect(typeof prefs[type][channel]).toBe('boolean');
      }
    }
  });

  it('merges stored preferences with defaults', async () => {
    let callCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // ensureNotificationPreferences: existing rows
        return makeChain({ all: vi.fn().mockResolvedValue([]) });
      }
      // getNotificationPreferences: stored rows
      return makeChain({
        all: vi.fn().mockResolvedValue([
          { type: 'run.completed', channel: 'in_app', enabled: false },
        ]),
      });
    });
    mocks.getDb.mockReturnValue(drizzle);

    const prefs = await getNotificationPreferences({} as never, 'user-1');
    // The stored value should override the default
    expect(prefs['run.completed'].in_app).toBe(false);
    // Other defaults should still be present
    expect(prefs['deploy.completed'].in_app).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateNotificationPreferences
// ---------------------------------------------------------------------------

describe('updateNotificationPreferences', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates new preferences for missing combos and updates existing', async () => {
    let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        // Existing rows check
        return makeChain({
          all: vi.fn().mockResolvedValue([
            { type: 'run.completed', channel: 'in_app' },
          ]),
        });
      }
      // ensureNotificationPreferences + getNotificationPreferences (subsequent calls)
      return makeChain({ all: vi.fn().mockResolvedValue([]) });
    });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await updateNotificationPreferences({} as never, 'user-1', [
      { type: 'run.completed', channel: 'in_app', enabled: false },
      { type: 'deploy.completed', channel: 'email', enabled: true },
    ]);

    // update should be called for existing combo
    expect(drizzle.update).toHaveBeenCalled();
    // insert should be called for new combo
    expect(drizzle.insert).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listNotifications
// ---------------------------------------------------------------------------

describe('listNotifications', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty when no enabled notification types', async () => {
    // All notification types have in_app disabled
    const emptyPrefs: Record<string, Record<string, boolean>> = {};
    for (const t of NOTIFICATION_TYPES) {
      emptyPrefs[t] = { in_app: false, email: false, push: false };
    }

    let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockImplementation(() => {
      selectCount++;
      if (selectCount <= 1) {
        // ensureNotificationPreferences
        return makeChain({ all: vi.fn().mockResolvedValue([]) });
      }
      if (selectCount <= 2) {
        // getNotificationPreferences: all disabled
        return makeChain({
          all: vi.fn().mockResolvedValue(
            NOTIFICATION_TYPES.flatMap(t =>
              NOTIFICATION_CHANNELS.map(c => ({ type: t, channel: c, enabled: false }))
            ),
          ),
        });
      }
      return makeChain();
    });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listNotifications({} as never, 'user-1');
    expect(result.notifications).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getUnreadCount
// ---------------------------------------------------------------------------

describe('getUnreadCount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 0 when no enabled types', async () => {
    let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockImplementation(() => {
      selectCount++;
      if (selectCount <= 2) {
        return makeChain({
          all: vi.fn().mockResolvedValue(
            NOTIFICATION_TYPES.flatMap(t =>
              NOTIFICATION_CHANNELS.map(c => ({ type: t, channel: c, enabled: false }))
            ),
          ),
        });
      }
      return makeChain();
    });
    mocks.getDb.mockReturnValue(drizzle);

    const count = await getUnreadCount({} as never, 'user-1');
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// markNotificationRead
// ---------------------------------------------------------------------------

describe('markNotificationRead', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates notification readAt field', async () => {
    const drizzle = makeDrizzle();
    mocks.getDb.mockReturnValue(drizzle);

    const result = await markNotificationRead({} as never, 'user-1', 'notif-1');
    expect(result).toEqual({ success: true });
    expect(drizzle.update).toHaveBeenCalled();
  });

  it('throws when notification table is missing', async () => {
    const drizzle = makeDrizzle();
    drizzle.update = vi.fn().mockImplementation(() => {
      throw new Error('no such table: notifications');
    });
    mocks.getDb.mockReturnValue(drizzle);

    await expect(markNotificationRead({} as never, 'user-1', 'notif-1')).rejects.toThrow(
      'Required table',
    );
  });
});

// ---------------------------------------------------------------------------
// createNotification
// ---------------------------------------------------------------------------

describe('createNotification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null notification_id when user disabled all channels', async () => {
    // All channels disabled for deploy.completed
    let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockImplementation(() => {
      selectCount++;
      if (selectCount <= 2) {
        return makeChain({
          all: vi.fn().mockResolvedValue(
            NOTIFICATION_CHANNELS.map(c => ({
              type: 'deploy.completed',
              channel: c,
              enabled: false,
            })),
          ),
        });
      }
      return makeChain();
    });
    mocks.getDb.mockReturnValue(drizzle);

    const env = { DB: {} as never } as unknown as Env;
    const result = await createNotification(env, {
      userId: 'user-1',
      type: 'deploy.completed',
      title: 'Deploy done',
    });

    expect(result.notification_id).toBeNull();
  });

  it('inserts notification and returns id when in_app is enabled', async () => {
    let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockImplementation(() => {
      selectCount++;
      // ensureNotificationPreferences + getNotificationPreferences
      if (selectCount <= 2) {
        return makeChain({
          all: vi.fn().mockResolvedValue([
            { type: 'deploy.completed', channel: 'in_app', enabled: true },
            { type: 'deploy.completed', channel: 'email', enabled: false },
            { type: 'deploy.completed', channel: 'push', enabled: false },
          ]),
        });
      }
      // isNotificationsMuted: no muted_until
      return makeChain({ get: vi.fn().mockResolvedValue(null) });
    });
    mocks.getDb.mockReturnValue(drizzle);

    const env = { DB: {} as never } as unknown as Env;
    const result = await createNotification(env, {
      userId: 'user-1',
      type: 'deploy.completed',
      title: 'Deploy succeeded',
      body: 'Your app deployed.',
      data: { appId: 'app-1' },
    });

    expect(result.notification_id).toBe('notif-id-1');
    expect(drizzle.insert).toHaveBeenCalled();
  });

  it('emits notification via durable object when not muted', async () => {
    let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = vi.fn().mockImplementation(() => {
      selectCount++;
      if (selectCount <= 2) {
        return makeChain({
          all: vi.fn().mockResolvedValue([
            { type: 'run.completed', channel: 'in_app', enabled: true },
          ]),
        });
      }
      return makeChain({ get: vi.fn().mockResolvedValue(null) });
    });
    mocks.getDb.mockReturnValue(drizzle);

    const stubFetch = vi.fn().mockResolvedValue(new Response('ok'));
    const env = {
      DB: {} as never,
      NOTIFICATION_NOTIFIER: {
        idFromName: vi.fn().mockReturnValue('id'),
        get: vi.fn().mockReturnValue({ fetch: stubFetch }),
      },
    } as unknown as Env;

    await createNotification(env, {
      userId: 'user-1',
      type: 'run.completed',
      title: 'Run done',
    });

    expect(stubFetch).toHaveBeenCalledTimes(1);
  });
});
