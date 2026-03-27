import { Hono } from 'hono';
import type { Env } from '../../../shared/types';
import type { BaseVariables } from '../shared/route-auth';
import { notFound, errorResponse } from '../shared/route-auth';
import { checkRunAccess } from './access';
import { getPlatformServices } from '../../../platform/accessors.ts';

type RunSseRouteEnv = { Bindings: Env; Variables: BaseVariables };

/**
 * SSE endpoint for run events — alternative to the WebSocket-based DO notifier
 * for Node.js / k8s environments.
 *
 * GET /api/runs/:id/sse
 */
export function createRunSseRouter(): Hono<RunSseRouteEnv> {
  const router = new Hono<RunSseRouteEnv>();

  router.get('/:id/sse', async (c) => {
    const user = c.get('user');
    const runId = c.req.param('id');

    // Auth — same as WS route
    const access = await checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      return notFound(c, 'Run');
    }

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

    // Subscribe to the run channel
    const channel = `run:${runId}`;
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
