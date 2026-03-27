import { Hono } from 'hono';
import type { Env } from '../../shared/types';
import type { BaseVariables } from './shared/route-auth';
import { errorResponse } from './shared/route-auth';
import { getPlatformServices } from '../../platform/accessors.ts';

type NotificationSseRouteEnv = { Bindings: Env; Variables: BaseVariables };

/**
 * SSE endpoint for user notifications — alternative to the WebSocket-based
 * DO notifier for Node.js / k8s environments.
 *
 * GET /api/notifications/sse
 */
export function createNotificationSseRouter(): Hono<NotificationSseRouteEnv> {
  const router = new Hono<NotificationSseRouteEnv>();

  router.get('/sse', async (c) => {
    const user = c.get('user');

    // Get SSE notifier from platform services
    const services = getPlatformServices(c as never);
    const sseNotifier = services.sseNotifier;
    if (!sseNotifier) {
      // SSE not available (running on CF Workers — use WebSocket instead)
      return errorResponse(c, 404, 'SSE not available in this environment. Use WebSocket endpoint instead.');
    }

    // Parse Last-Event-ID from header or query parameter
    const lastEventIdRaw =
      c.req.header('Last-Event-ID') ?? c.req.query('last_event_id');
    let lastEventId: number | undefined;
    if (lastEventIdRaw) {
      const parsed = parseInt(lastEventIdRaw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        lastEventId = parsed;
      }
    }

    // Subscribe to the user's notification channel
    const channel = `notifications:${user.id}`;
    const stream = sseNotifier.subscribe(channel, lastEventId);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });

  return router;
}
