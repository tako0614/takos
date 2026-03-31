import { assertEquals, assert, assertRejects } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: (() => 'notif-id-1'),
  now: (() => '2025-01-01T00:00:00.000Z'),
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
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
} from '@/services/notifications/service';

import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from '@/services/notifications/types';

import type { Env } from '@/types';

function makeChain(overrides: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = {};
  c.from = (() => c);
  c.where = (() => c);
  c.orderBy = (() => c);
  c.limit = (() => c);
  c.get = (async () => null);
  c.all = (async () => []);
  c.run = (async () => ({ meta: { changes: 1 } }));
  c.returning = (() => c);
  Object.assign(c, overrides);
  return c;
}

function makeDrizzle() {
  return {
    select: () => makeChain(),
    insert: () => {
      const c: Record<string, unknown> = {};
      c.values = (() => c);
      c.run = (async () => ({ meta: { changes: 1 } }));
      c.returning = (() => c);
      c.get = (async () => null);
      return c;
    },
    update: () => {
      const c: Record<string, unknown> = {};
      c.set = (() => c);
      c.where = (() => c);
      c.run = (async () => ({ meta: { changes: 1 } }));
      c.returning = (() => c);
      c.get = (async () => null);
      return c;
    },
    delete: () => {
      const c: Record<string, unknown> = {};
      c.where = (() => c);
      c.run = (async () => ({ meta: { changes: 1 } }));
      return c;
    },
  };
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------


  Deno.test('updateNotificationPreferencesSchema - accepts valid updates', () => {
  const result = updateNotificationPreferencesSchema.safeParse({
      updates: [{ type: 'run.completed', channel: 'in_app', enabled: true }],
    });
    assertEquals(result.success, true);
})
  Deno.test('updateNotificationPreferencesSchema - rejects empty updates array', () => {
  const result = updateNotificationPreferencesSchema.safeParse({ updates: [] });
    assertEquals(result.success, false);
})
  Deno.test('updateNotificationPreferencesSchema - rejects invalid notification type', () => {
  const result = updateNotificationPreferencesSchema.safeParse({
      updates: [{ type: 'invalid.type', channel: 'in_app', enabled: true }],
    });
    assertEquals(result.success, false);
})
  Deno.test('updateNotificationPreferencesSchema - rejects invalid channel', () => {
  const result = updateNotificationPreferencesSchema.safeParse({
      updates: [{ type: 'run.completed', channel: 'sms', enabled: true }],
    });
    assertEquals(result.success, false);
})

  Deno.test('setMutedUntilSchema - accepts valid datetime string', () => {
  const result = setMutedUntilSchema.safeParse({ muted_until: '2025-12-31T23:59:59Z' });
    assertEquals(result.success, true);
})
  Deno.test('setMutedUntilSchema - accepts null', () => {
  const result = setMutedUntilSchema.safeParse({ muted_until: null });
    assertEquals(result.success, true);
})
  Deno.test('setMutedUntilSchema - rejects invalid datetime string', () => {
  const result = setMutedUntilSchema.safeParse({ muted_until: 'not-a-date' });
    assertEquals(result.success, false);
})

  Deno.test('listNotificationsQuerySchema - accepts valid limit and before', () => {
  const result = listNotificationsQuerySchema.safeParse({
      limit: 10,
      before: '2025-01-01T00:00:00Z',
    });
    assertEquals(result.success, true);
})
  Deno.test('listNotificationsQuerySchema - rejects limit over 50', () => {
  const result = listNotificationsQuerySchema.safeParse({ limit: 100 });
    assertEquals(result.success, false);
})
  Deno.test('listNotificationsQuerySchema - rejects non-positive limit', () => {
  const result = listNotificationsQuerySchema.safeParse({ limit: 0 });
    assertEquals(result.success, false);
})
// ---------------------------------------------------------------------------
// ensureNotificationSettings
// ---------------------------------------------------------------------------


  
  Deno.test('ensureNotificationSettings - inserts settings when none exist', async () => {
  const drizzle = makeDrizzle();
    mocks.getDb = (() => drizzle) as any;

    await ensureNotificationSettings({} as never, 'user-1');

    assert(drizzle.select.calls.length > 0);
    assert(drizzle.insert.calls.length > 0);
})
  Deno.test('ensureNotificationSettings - does not insert when settings already exist', async () => {
  const selectChain = makeChain({
      get: (async () => ({ accountId: 'user-1' })),
    });
    const drizzle = makeDrizzle();
    drizzle.select = (() => selectChain);
    mocks.getDb = (() => drizzle) as any;

    await ensureNotificationSettings({} as never, 'user-1');

    assertSpyCalls(drizzle.insert, 0);
})
  Deno.test('ensureNotificationSettings - throws descriptive error when table is missing', async () => {
  const drizzle = makeDrizzle();
    drizzle.select = () => {
      throw new Error('no such table: notification_settings');
    };
    mocks.getDb = (() => drizzle) as any;

    await await assertRejects(async () => { await ensureNotificationSettings({} as never, 'user-1'); }, 
      'Required table',
    );
})
// ---------------------------------------------------------------------------
// getNotificationsMutedUntil / isNotificationsMuted
// ---------------------------------------------------------------------------


  
  Deno.test('getNotificationsMutedUntil - returns null when no settings row found', async () => {
  const drizzle = makeDrizzle();
    mocks.getDb = (() => drizzle) as any;

    const result = await getNotificationsMutedUntil({} as never, 'user-1');
    assertEquals(result, null);
})
  Deno.test('getNotificationsMutedUntil - returns muted_until value when set', async () => {
  const selectChain = makeChain({
      get: (async () => ({ mutedUntil: '2025-12-31T23:59:59Z' })),
    });
    const drizzle = makeDrizzle();
    drizzle.select = (() => selectChain);
    mocks.getDb = (() => drizzle) as any;

    const result = await getNotificationsMutedUntil({} as never, 'user-1');
    assertEquals(result, '2025-12-31T23:59:59Z');
})

  
  Deno.test('isNotificationsMuted - returns false when no muted_until is set', async () => {
  const drizzle = makeDrizzle();
    mocks.getDb = (() => drizzle) as any;

    const result = await isNotificationsMuted({} as never, 'user-1');
    assertEquals(result, false);
})
  Deno.test('isNotificationsMuted - returns true when muted_until is in the future', async () => {
  const futureDate = new Date(Date.now() + 3600_000).toISOString();
    const selectChain = makeChain({
      get: (async () => ({ mutedUntil: futureDate })),
    });
    const drizzle = makeDrizzle();
    drizzle.select = (() => selectChain);
    mocks.getDb = (() => drizzle) as any;

    const result = await isNotificationsMuted({} as never, 'user-1');
    assertEquals(result, true);
})
  Deno.test('isNotificationsMuted - returns false when muted_until is in the past', async () => {
  const pastDate = new Date(Date.now() - 3600_000).toISOString();
    const selectChain = makeChain({
      get: (async () => ({ mutedUntil: pastDate })),
    });
    const drizzle = makeDrizzle();
    drizzle.select = (() => selectChain);
    mocks.getDb = (() => drizzle) as any;

    const result = await isNotificationsMuted({} as never, 'user-1');
    assertEquals(result, false);
})
// ---------------------------------------------------------------------------
// setNotificationsMutedUntil
// ---------------------------------------------------------------------------


  
  Deno.test('setNotificationsMutedUntil - updates existing settings row', async () => {
  const selectChain = makeChain({
      get: (async () => ({ mutedUntil: null })),
    });
    const updateChain = makeChain({
      get: (async () => ({ mutedUntil: '2025-06-01T00:00:00.000Z' })),
    });
    const drizzle = makeDrizzle();
    drizzle.select = (() => selectChain);
    drizzle.update = () => {
      const c: Record<string, unknown> = {};
      c.set = (() => c);
      c.where = (() => c);
      c.returning = (() => c);
      c.get = (async () => ({ mutedUntil: '2025-06-01T00:00:00.000Z' }));
      return c;
    };
    mocks.getDb = (() => drizzle) as any;

    const result = await setNotificationsMutedUntil({} as never, 'user-1', '2025-06-01T00:00:00Z');
    assertEquals(result.muted_until, '2025-06-01T00:00:00.000Z');
})
  Deno.test('setNotificationsMutedUntil - clears muted_until when null is passed', async () => {
  const selectChain = makeChain({
      get: (async () => ({ mutedUntil: '2025-06-01T00:00:00Z' })),
    });
    const drizzle = makeDrizzle();
    drizzle.select = (() => selectChain);
    drizzle.update = () => {
      const c: Record<string, unknown> = {};
      c.set = (() => c);
      c.where = (() => c);
      c.returning = (() => c);
      c.get = (async () => ({ mutedUntil: null }));
      return c;
    };
    mocks.getDb = (() => drizzle) as any;

    const result = await setNotificationsMutedUntil({} as never, 'user-1', null);
    assertEquals(result.muted_until, null);
})
// ---------------------------------------------------------------------------
// getNotificationPreferences / ensureNotificationPreferences
// ---------------------------------------------------------------------------


  
  Deno.test('getNotificationPreferences - returns default preferences when no rows exist', async () => {
  const drizzle = makeDrizzle();
    // All selects return empty (no existing preferences)
    mocks.getDb = (() => drizzle) as any;

    const prefs = await getNotificationPreferences({} as never, 'user-1');

    // Check that all types and channels are present
    for (const type of NOTIFICATION_TYPES) {
      assert(prefs[type] !== undefined);
      for (const channel of NOTIFICATION_CHANNELS) {
        assertEquals(typeof prefs[type][channel], 'boolean');
      }
    }
})
  Deno.test('getNotificationPreferences - merges stored preferences with defaults', async () => {
  let callCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = () => {
      callCount++;
      if (callCount === 1) {
        // ensureNotificationPreferences: existing rows
        return makeChain({ all: (async () => []) });
      }
      // getNotificationPreferences: stored rows
      return makeChain({
        all: (async () => [
          { type: 'run.completed', channel: 'in_app', enabled: false },
        ]),
      });
    };
    mocks.getDb = (() => drizzle) as any;

    const prefs = await getNotificationPreferences({} as never, 'user-1');
    // The stored value should override the default
    assertEquals(prefs['run.completed'].in_app, false);
    // Other defaults should still be present
    assertEquals(prefs['deploy.completed'].in_app, true);
})
// ---------------------------------------------------------------------------
// updateNotificationPreferences
// ---------------------------------------------------------------------------


  
  Deno.test('updateNotificationPreferences - creates new preferences for missing combos and updates existing', async () => {
  let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = () => {
      selectCount++;
      if (selectCount === 1) {
        // Existing rows check
        return makeChain({
          all: (async () => [
            { type: 'run.completed', channel: 'in_app' },
          ]),
        });
      }
      // ensureNotificationPreferences + getNotificationPreferences (subsequent calls)
      return makeChain({ all: (async () => []) });
    };
    mocks.getDb = (() => drizzle) as any;

    const result = await updateNotificationPreferences({} as never, 'user-1', [
      { type: 'run.completed', channel: 'in_app', enabled: false },
      { type: 'deploy.completed', channel: 'email', enabled: true },
    ]);

    // update should be called for existing combo
    assert(drizzle.update.calls.length > 0);
    // insert should be called for new combo
    assert(drizzle.insert.calls.length > 0);
})
// ---------------------------------------------------------------------------
// listNotifications
// ---------------------------------------------------------------------------


  
  Deno.test('listNotifications - returns empty when no enabled notification types', async () => {
  // All notification types have in_app disabled
    const emptyPrefs: Record<string, Record<string, boolean>> = {};
    for (const t of NOTIFICATION_TYPES) {
      emptyPrefs[t] = { in_app: false, email: false, push: false };
    }

    let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = () => {
      selectCount++;
      if (selectCount <= 1) {
        // ensureNotificationPreferences
        return makeChain({ all: (async () => []) });
      }
      if (selectCount <= 2) {
        // getNotificationPreferences: all disabled
        return makeChain({
          all: (async () => NOTIFICATION_TYPES.flatMap(t =>
              NOTIFICATION_CHANNELS.map(c => ({ type: t, channel: c, enabled: false }))
            ),),
        });
      }
      return makeChain();
    };
    mocks.getDb = (() => drizzle) as any;

    const result = await listNotifications({} as never, 'user-1');
    assertEquals(result.notifications, []);
})
// ---------------------------------------------------------------------------
// getUnreadCount
// ---------------------------------------------------------------------------


  
  Deno.test('getUnreadCount - returns 0 when no enabled types', async () => {
  let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = () => {
      selectCount++;
      if (selectCount <= 2) {
        return makeChain({
          all: (async () => NOTIFICATION_TYPES.flatMap(t =>
              NOTIFICATION_CHANNELS.map(c => ({ type: t, channel: c, enabled: false }))
            ),),
        });
      }
      return makeChain();
    };
    mocks.getDb = (() => drizzle) as any;

    const count = await getUnreadCount({} as never, 'user-1');
    assertEquals(count, 0);
})
// ---------------------------------------------------------------------------
// markNotificationRead
// ---------------------------------------------------------------------------


  
  Deno.test('markNotificationRead - updates notification readAt field', async () => {
  const drizzle = makeDrizzle();
    mocks.getDb = (() => drizzle) as any;

    const result = await markNotificationRead({} as never, 'user-1', 'notif-1');
    assertEquals(result, { success: true });
    assert(drizzle.update.calls.length > 0);
})
  Deno.test('markNotificationRead - throws when notification table is missing', async () => {
  const drizzle = makeDrizzle();
    drizzle.update = () => {
      throw new Error('no such table: notifications');
    };
    mocks.getDb = (() => drizzle) as any;

    await await assertRejects(async () => { await markNotificationRead({} as never, 'user-1', 'notif-1'); }, 
      'Required table',
    );
})
// ---------------------------------------------------------------------------
// createNotification
// ---------------------------------------------------------------------------


  
  Deno.test('createNotification - returns null notification_id when user disabled all channels', async () => {
  // All channels disabled for deploy.completed
    let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = () => {
      selectCount++;
      if (selectCount <= 2) {
        return makeChain({
          all: (async () => NOTIFICATION_CHANNELS.map(c => ({
              type: 'deploy.completed',
              channel: c,
              enabled: false,
            })),),
        });
      }
      return makeChain();
    };
    mocks.getDb = (() => drizzle) as any;

    const env = { DB: {} as never } as unknown as Env;
    const result = await createNotification(env, {
      userId: 'user-1',
      type: 'deploy.completed',
      title: 'Deploy done',
    });

    assertEquals(result.notification_id, null);
})
  Deno.test('createNotification - inserts notification and returns id when in_app is enabled', async () => {
  let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = () => {
      selectCount++;
      // ensureNotificationPreferences + getNotificationPreferences
      if (selectCount <= 2) {
        return makeChain({
          all: (async () => [
            { type: 'deploy.completed', channel: 'in_app', enabled: true },
            { type: 'deploy.completed', channel: 'email', enabled: false },
            { type: 'deploy.completed', channel: 'push', enabled: false },
          ]),
        });
      }
      // isNotificationsMuted: no muted_until
      return makeChain({ get: (async () => null) });
    };
    mocks.getDb = (() => drizzle) as any;

    const env = { DB: {} as never } as unknown as Env;
    const result = await createNotification(env, {
      userId: 'user-1',
      type: 'deploy.completed',
      title: 'Deploy succeeded',
      body: 'Your app deployed.',
      data: { appId: 'app-1' },
    });

    assertEquals(result.notification_id, 'notif-id-1');
    assert(drizzle.insert.calls.length > 0);
})
  Deno.test('createNotification - emits notification via durable object when not muted', async () => {
  let selectCount = 0;
    const drizzle = makeDrizzle();
    drizzle.select = () => {
      selectCount++;
      if (selectCount <= 2) {
        return makeChain({
          all: (async () => [
            { type: 'run.completed', channel: 'in_app', enabled: true },
          ]),
        });
      }
      return makeChain({ get: (async () => null) });
    };
    mocks.getDb = (() => drizzle) as any;

    const stubFetch = (async () => new Response('ok'));
    const env = {
      DB: {} as never,
      NOTIFICATION_NOTIFIER: {
        idFromName: (() => 'id'),
        get: (() => ({ fetch: stubFetch })),
      },
    } as unknown as Env;

    await createNotification(env, {
      userId: 'user-1',
      type: 'run.completed',
      title: 'Run done',
    });

    assertSpyCalls(stubFetch, 1);
})