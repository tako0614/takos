import type { D1Database } from '../../../shared/types/bindings.ts';
import { z } from 'zod';
import type { Env } from '../../../shared/types';
import { getDb, notificationSettings, notificationPreferences, notifications } from '../../../infra/db';
import { eq, and, lt, inArray, isNull, count, desc } from 'drizzle-orm';
import { generateId, now, safeJsonParseOrDefault } from '../../../shared/utils';
import { buildDurableObjectUrl } from '../../../shared/utils';
import { logWarn } from '../../../shared/utils/logger';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationPreferenceMatrix,
  type NotificationType,
} from './types';

// ── Zod schemas for API input validation ──

export const updateNotificationPreferencesSchema = z.object({
  updates: z.array(
    z.object({
      type: z.enum(NOTIFICATION_TYPES),
      channel: z.enum(NOTIFICATION_CHANNELS),
      enabled: z.boolean(),
    }),
  ).min(1).max(NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length),
});

export const setMutedUntilSchema = z.object({
  muted_until: z
    .string()
    .refine((v) => Number.isFinite(Date.parse(v)), { message: 'muted_until must be a valid datetime' })
    .nullable(),
});

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  before: z
    .string()
    .refine((v) => Number.isFinite(Date.parse(v)), { message: 'before must be a valid datetime' })
    .optional(),
});

export type NotificationDto = {
  id: string;
  user_id: string;
  space_id: string | null;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

type NotificationNotifierNamespace = NonNullable<Env['NOTIFICATION_NOTIFIER']>;
type NotificationNotifierStub = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};
type NotificationNotifierNamespaceLike = {
  idFromName(name: string): unknown;
  get(id: unknown): NotificationNotifierStub;
};

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('no such table');
}

function extractMissingTableName(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/no such table:?\s*([A-Za-z0-9_]+)/i);
  return match?.[1] ?? null;
}

function throwMissingNotificationTable(err: unknown, fallbackTable: string): never {
  const table = extractMissingTableName(err) ?? fallbackTable;
  throw new Error(
    `[notifications] Required table "${table}" is missing. Apply notification migrations before using notifications.`,
  );
}

function getNotificationNotifierStub(env: Env, userId: string): NotificationNotifierStub | null {
  const namespace = env.NOTIFICATION_NOTIFIER as NotificationNotifierNamespace | undefined;
  if (!namespace) return null;
  const notifierNamespace = namespace as unknown as NotificationNotifierNamespaceLike;
  return notifierNamespace.get(notifierNamespace.idFromName(userId));
}

async function emitNotificationCreated(stub: NotificationNotifierStub, notificationId: string): Promise<void> {
  const request = new Request(buildDurableObjectUrl('/emit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Takos-Internal': '1' },
    body: JSON.stringify({
      type: 'notification.new',
      data: {
        notification_id: notificationId,
      },
    }),
  });
  await stub.fetch(request);
}

export async function ensureNotificationSettings(dbBinding: D1Database, userId: string): Promise<void> {
  const db = getDb(dbBinding);
  const ts = now();
  try {
    const existingSettings = await db.select().from(notificationSettings)
      .where(eq(notificationSettings.accountId, userId)).get();
    if (!existingSettings) {
      try {
        await db.insert(notificationSettings).values({
          accountId: userId, mutedUntil: null, createdAt: ts, updatedAt: ts,
        });
      } catch { /* race condition: already exists */ }
    }
  } catch (err) {
    if (isMissingTableError(err)) {
      throwMissingNotificationTable(err, 'notification_settings');
    }
    throw err;
  }
}

export async function getNotificationsMutedUntil(dbBinding: D1Database, userId: string): Promise<string | null> {
  const db = getDb(dbBinding);
  try {
    const row = await db.select({ mutedUntil: notificationSettings.mutedUntil }).from(notificationSettings)
      .where(eq(notificationSettings.accountId, userId)).get();
    return row?.mutedUntil ?? null;
  } catch (err) {
    if (isMissingTableError(err)) {
      throwMissingNotificationTable(err, 'notification_settings');
    }
    throw err;
  }
}

export async function isNotificationsMuted(dbBinding: D1Database, userId: string): Promise<boolean> {
  const mutedUntil = await getNotificationsMutedUntil(dbBinding, userId);
  if (!mutedUntil) return false;
  const untilMs = Date.parse(mutedUntil);
  if (!Number.isFinite(untilMs)) return false;
  return untilMs > Date.now();
}

export async function setNotificationsMutedUntil(
  dbBinding: D1Database,
  userId: string,
  mutedUntil: string | null
): Promise<{ muted_until: string | null }> {
  const db = getDb(dbBinding);
  const ts = now();
  const mutedValue = mutedUntil ? new Date(mutedUntil).toISOString() : null;
  try {
    const row = await db.select({ mutedUntil: notificationSettings.mutedUntil }).from(notificationSettings)
      .where(eq(notificationSettings.accountId, userId)).get();
    if (row) {
      const updated = await db.update(notificationSettings)
        .set({ mutedUntil: mutedValue, updatedAt: ts })
        .where(eq(notificationSettings.accountId, userId))
        .returning({ mutedUntil: notificationSettings.mutedUntil })
        .get();
      return { muted_until: updated?.mutedUntil ?? null };
    } else {
      try {
        const created = await db.insert(notificationSettings).values({
          accountId: userId, mutedUntil: mutedValue, createdAt: ts, updatedAt: ts,
        }).returning({ mutedUntil: notificationSettings.mutedUntil }).get();
        return { muted_until: created?.mutedUntil ?? null };
      } catch {
        const updated = await db.update(notificationSettings)
          .set({ mutedUntil: mutedValue, updatedAt: ts })
          .where(eq(notificationSettings.accountId, userId))
          .returning({ mutedUntil: notificationSettings.mutedUntil })
          .get();
        return { muted_until: updated?.mutedUntil ?? null };
      }
    }
  } catch (err) {
    if (isMissingTableError(err)) {
      throwMissingNotificationTable(err, 'notification_settings');
    }
    throw err;
  }
}

function emptyMatrix(): NotificationPreferenceMatrix {
  const matrix = {} as NotificationPreferenceMatrix;
  for (const t of NOTIFICATION_TYPES) {
    matrix[t] = { in_app: false, email: false, push: false };
  }
  return matrix;
}

export async function ensureNotificationPreferences(dbBinding: D1Database, userId: string): Promise<void> {
  const db = getDb(dbBinding);
  const ts = now();
  try {
    const existing = await db.select({
      type: notificationPreferences.type,
      channel: notificationPreferences.channel,
    }).from(notificationPreferences)
      .where(eq(notificationPreferences.accountId, userId))
      .all();
    const existingSet = new Set(existing.map((r) => `${r.type}:${r.channel}`));
    const toCreate: Array<{
      accountId: string; type: string; channel: string;
      enabled: boolean; createdAt: string; updatedAt: string;
    }> = [];

    for (const type of NOTIFICATION_TYPES) {
      for (const channel of NOTIFICATION_CHANNELS) {
        const key = `${type}:${channel}`;
        if (existingSet.has(key)) continue;
        const enabled = DEFAULT_NOTIFICATION_PREFERENCES[type][channel];
        toCreate.push({ accountId: userId, type, channel, enabled, createdAt: ts, updatedAt: ts });
      }
    }

    if (toCreate.length > 0) {
      try {
        await db.insert(notificationPreferences).values(toCreate);
      } catch (err) {
        // Possible race; re-query on next read.
        logWarn('Failed to create default preferences', { module: 'notifications', error: err instanceof Error ? err.message : String(err) });
      }
    }
  } catch (err) {
    if (isMissingTableError(err)) {
      throwMissingNotificationTable(err, 'notification_preferences');
    }
    throw err;
  }
}

export async function getNotificationPreferences(dbBinding: D1Database, userId: string): Promise<NotificationPreferenceMatrix> {
  await ensureNotificationPreferences(dbBinding, userId);
  const db = getDb(dbBinding);
  try {
    const rows = await db.select({
      type: notificationPreferences.type,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    }).from(notificationPreferences)
      .where(eq(notificationPreferences.accountId, userId))
      .all();
    const matrix: NotificationPreferenceMatrix = emptyMatrix();
    const seen = new Set<string>();
    for (const row of rows) {
      const type = row.type as NotificationType;
      const channel = row.channel as NotificationChannel;
      if (!(type in matrix)) continue;
      if (!NOTIFICATION_CHANNELS.includes(channel)) continue;
      matrix[type][channel] = row.enabled;
      seen.add(`${type}:${channel}`);
    }
    // Apply defaults for missing combos (avoid "false" being treated as default)
    for (const type of NOTIFICATION_TYPES) {
      for (const channel of NOTIFICATION_CHANNELS) {
        const key = `${type}:${channel}`;
        if (!seen.has(key)) {
          matrix[type][channel] = DEFAULT_NOTIFICATION_PREFERENCES[type][channel];
        }
      }
    }
    return matrix;
  } catch (err) {
    if (isMissingTableError(err)) {
      throwMissingNotificationTable(err, 'notification_preferences');
    }
    throw err;
  }
}

export async function updateNotificationPreferences(
  dbBinding: D1Database,
  userId: string,
  updates: Array<{ type: NotificationType; channel: NotificationChannel; enabled: boolean }>
): Promise<NotificationPreferenceMatrix> {
  const db = getDb(dbBinding);
  const ts = now();
  try {
    // 1. Batch-fetch all existing preferences for this user
    const existingRows = await db.select({
      type: notificationPreferences.type,
      channel: notificationPreferences.channel,
    }).from(notificationPreferences)
      .where(eq(notificationPreferences.accountId, userId))
      .all();
    const existingSet = new Set(existingRows.map((r) => `${r.type}:${r.channel}`));

    // 2. Partition updates into creates vs updates
    const toCreate: Array<{
      accountId: string; type: string; channel: string;
      enabled: boolean; createdAt: string; updatedAt: string;
    }> = [];
    const toUpdate: Array<{ type: NotificationType; channel: NotificationChannel; enabled: boolean }> = [];

    for (const u of updates) {
      const key = `${u.type}:${u.channel}`;
      if (existingSet.has(key)) {
        toUpdate.push(u);
      } else {
        toCreate.push({
          accountId: userId,
          type: u.type,
          channel: u.channel,
          enabled: !!u.enabled,
          createdAt: ts,
          updatedAt: ts,
        });
      }
    }

    // 3. Batch-create new preferences in one query
    if (toCreate.length > 0) {
      await db.insert(notificationPreferences).values(toCreate);
    }

    // 4. Update existing preferences sequentially (D1 does not support transactions)
    for (const u of toUpdate) {
      await db.update(notificationPreferences)
        .set({ enabled: !!u.enabled, updatedAt: ts })
        .where(and(
          eq(notificationPreferences.accountId, userId),
          eq(notificationPreferences.type, u.type),
          eq(notificationPreferences.channel, u.channel),
        ));
    }
  } catch (err) {
    if (isMissingTableError(err)) {
      throwMissingNotificationTable(err, 'notification_preferences');
    }
    throw err;
  }
  return getNotificationPreferences(dbBinding, userId);
}

export async function listNotifications(
  dbBinding: D1Database,
  userId: string,
  opts?: { limit?: number; before?: string | null }
): Promise<{ notifications: NotificationDto[] }> {
  const db = getDb(dbBinding);
  const limitInput = opts?.limit;
  const limitVal = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput as number, 1), 50) : 20;

  let before: string | null = null;
  if (opts?.before) {
    const beforeMs = Date.parse(opts.before);
    if (Number.isFinite(beforeMs)) {
      before = new Date(beforeMs).toISOString();
    }
  }

  const prefs = await getNotificationPreferences(dbBinding, userId);
  const enabledTypes = NOTIFICATION_TYPES.filter((t) => prefs[t].in_app);
  if (enabledTypes.length === 0) return { notifications: [] };

  try {
    const conditions = [
      eq(notifications.recipientAccountId, userId),
      inArray(notifications.type, enabledTypes),
    ];
    if (before) {
      conditions.push(lt(notifications.createdAt, before));
    }

    const rows = await db.select({
      id: notifications.id,
      recipientAccountId: notifications.recipientAccountId,
      accountId: notifications.accountId,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      data: notifications.data,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    }).from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limitVal)
      .all();

    return {
      notifications: rows.map((n) => ({
        id: n.id,
        user_id: n.recipientAccountId,
        space_id: n.accountId ?? null,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        data: safeJsonParseOrDefault<Record<string, unknown>>(n.data, {}),
        read_at: n.readAt ?? null,
        created_at: n.createdAt,
      })),
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      throwMissingNotificationTable(err, 'notifications');
    }
    throw err;
  }
}

export async function getUnreadCount(dbBinding: D1Database, userId: string): Promise<number> {
  const db = getDb(dbBinding);
  const prefs = await getNotificationPreferences(dbBinding, userId);
  const enabledTypes = NOTIFICATION_TYPES.filter((t) => prefs[t].in_app);
  if (enabledTypes.length === 0) return 0;

  try {
    const result = await db.select({ count: count() }).from(notifications)
      .where(and(
        eq(notifications.recipientAccountId, userId),
        inArray(notifications.type, enabledTypes),
        isNull(notifications.readAt),
      ))
      .get();
    return result?.count ?? 0;
  } catch (err) {
    if (isMissingTableError(err)) {
      throwMissingNotificationTable(err, 'notifications');
    }
    throw err;
  }
}

export async function markNotificationRead(
  dbBinding: D1Database,
  userId: string,
  notificationId: string
): Promise<{ success: true }> {
  const db = getDb(dbBinding);
  try {
    await db.update(notifications)
      .set({ readAt: now() })
      .where(and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientAccountId, userId),
        isNull(notifications.readAt),
      ));
  } catch (err) {
    if (isMissingTableError(err)) {
      throwMissingNotificationTable(err, 'notifications');
    }
    throw err;
  }
  return { success: true };
}

export async function createNotification(
  env: Env,
  input: {
    userId: string;
    spaceId?: string | null;
    type: NotificationType;
    title: string;
    body?: string | null;
    data?: Record<string, unknown> | null;
  }
): Promise<{ notification_id: string | null }> {
  const db = getDb(env.DB);

  const prefs = await getNotificationPreferences(env.DB, input.userId);
  const channelPrefs = prefs[input.type] || DEFAULT_NOTIFICATION_PREFERENCES[input.type];
  const wantsInApp = !!channelPrefs.in_app;
  const wantsPush = !!channelPrefs.push;
  if (!wantsInApp && !wantsPush) {
    return { notification_id: null };
  }

  const id = generateId(16);
  const ts = now();
  const muted = await isNotificationsMuted(env.DB, input.userId);

  const dataStr = JSON.stringify(input.data ?? {});
  const MAX_NOTIFICATION_DATA_SIZE = 10_000;
  if (dataStr.length > MAX_NOTIFICATION_DATA_SIZE) {
    logWarn('Notification data exceeds size limit, truncating payload', { module: 'notifications', ...{
      type: input.type,
      size: dataStr.length,
    } });
  }

  try {
    await db.insert(notifications).values({
      id,
      recipientAccountId: input.userId,
      accountId: input.spaceId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      data: dataStr.length <= MAX_NOTIFICATION_DATA_SIZE ? dataStr : '{}',
      createdAt: ts,
      emailStatus: 'skipped',
      emailAttempts: 0,
      emailSentAt: null,
      emailError: null,
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      throwMissingNotificationTable(err, 'notifications');
    }
    throw err;
  }

  if (wantsInApp && !muted && env.NOTIFICATION_NOTIFIER) {
    try {
      const stub = getNotificationNotifierStub(env, input.userId);
      if (stub) {
        await emitNotificationCreated(stub, id);
      }
    } catch (err) {
      logWarn('Failed to emit notification via DO', { module: 'notifications', error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { notification_id: id };
}
