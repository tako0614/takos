import { Hono } from 'hono';
import { z } from 'zod';
import type { Context } from 'hono';
import type { Env } from '../../shared/types';
import { AppError, BadRequestError, InternalError, parseLimit, type BaseVariables } from './shared/route-auth';
import { zValidator } from './zod-validator';
import { buildSanitizedDOHeaders } from '../../runtime/durable-objects/shared';
import {
  getNotificationPreferences,
  getNotificationsMutedUntil,
  getUnreadCount,
  listNotifications,
  markNotificationRead,
  setNotificationsMutedUntil,
  updateNotificationPreferences,
} from '../../application/services/notifications/service';
import {
  isNotificationChannel,
  isNotificationType,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationType,
} from '../../application/services/notifications/types';

type NotificationContext = Context<{ Bindings: Env; Variables: BaseVariables }>;
type NotificationNotifierNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
};

const notificationsWsHandler: (c: NotificationContext) => Promise<Response> = async (c) => {
  const user = c.get('user');

  if (!c.env.NOTIFICATION_NOTIFIER) {
    throw new InternalError('Notifications WebSocket not configured');
  }

  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    throw new AppError('Expected WebSocket upgrade', undefined, 426);
  }

  const namespace = c.env.NOTIFICATION_NOTIFIER as unknown as NotificationNotifierNamespace;
  const id = namespace.idFromName(user.id);
  const stub = namespace.get(id);

  const headers = buildSanitizedDOHeaders(c.req.raw.headers, { 'X-WS-Auth-Validated': 'true', 'X-WS-User-Id': user.id });

  return stub.fetch(c.req.raw.url, {
    method: c.req.raw.method,
    headers,
    body: c.req.raw.body as never,
  }) as unknown as Response;
};

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  // GET /api/notifications
  .get('/notifications',
    zValidator('query', z.object({
      limit: z.string().optional(),
      before: z.string().refine(
        (v) => !v || Number.isFinite(Date.parse(v)),
        { message: 'before must be a valid datetime' }
      ).optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const validatedQuery = c.req.valid('query');

    const limit = validatedQuery.limit
      ? parseLimit(validatedQuery.limit, 50, 100)
      : undefined;
    const before = validatedQuery.before || null;

    const result = await listNotifications(c.env.DB, user.id, { limit, before });
    return c.json(result);
  })

  // GET /api/notifications/unread-count
  .get('/notifications/unread-count', async (c) => {
    const user = c.get('user');
    const unreadCount = await getUnreadCount(c.env.DB, user.id);
    return c.json({ unread_count: unreadCount });
  })

  // PATCH /api/notifications/:id/read
  .patch('/notifications/:id/read', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const result = await markNotificationRead(c.env.DB, user.id, id);
    return c.json(result);
  })

  // GET /api/notifications/preferences
  .get('/notifications/preferences', async (c) => {
    const user = c.get('user');
    const prefs = await getNotificationPreferences(c.env.DB, user.id);
    return c.json({
      types: NOTIFICATION_TYPES,
      channels: NOTIFICATION_CHANNELS,
      preferences: prefs,
    });
  })

  // PATCH /api/notifications/preferences
  .patch('/notifications/preferences',
    zValidator('json', z.object({
      updates: z.array(z.object({
        type: z.string(),
        channel: z.string(),
        enabled: z.boolean(),
      })),
    })),
    async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    const updates: Array<{ type: NotificationType; channel: NotificationChannel; enabled: boolean }> = [];
    for (const row of body.updates) {
      if (!isNotificationType(row.type)) throw new BadRequestError(`Invalid type: ${String(row.type)}`);
      if (!isNotificationChannel(row.channel)) throw new BadRequestError(`Invalid channel: ${String(row.channel)}`);
      updates.push({ type: row.type, channel: row.channel, enabled: row.enabled });
    }

    const prefs = await updateNotificationPreferences(c.env.DB, user.id, updates);
    return c.json({
      types: NOTIFICATION_TYPES,
      channels: NOTIFICATION_CHANNELS,
      preferences: prefs,
    });
  })

  // GET /api/notifications/settings
  .get('/notifications/settings', async (c) => {
    const user = c.get('user');
    const mutedUntil = await getNotificationsMutedUntil(c.env.DB, user.id);
    return c.json({ muted_until: mutedUntil });
  })

  // PATCH /api/notifications/settings
  .patch('/notifications/settings',
    zValidator('json', z.object({
      muted_until: z.string().refine(
        (v) => Number.isFinite(Date.parse(v)),
        { message: 'muted_until must be a valid datetime' }
      ).nullable(),
    })),
    async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    const result = await setNotificationsMutedUntil(c.env.DB, user.id, body.muted_until);
    return c.json(result);
  })

  // GET /api/notifications/ws (WebSocket, user-scoped)
  .get('/notifications/ws', notificationsWsHandler as never);
