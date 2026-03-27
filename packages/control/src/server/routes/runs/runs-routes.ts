import { Hono } from 'hono';
import { z } from 'zod';
import type { Artifact, ArtifactType, Env } from '../../../shared/types';
import { getDb } from '../../../infra/db';
import { runs, artifacts } from '../../../infra/db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import {
  RUN_TERMINAL_STATUSES,
  buildTerminalPayload,
} from '../../../application/services/run-notifier';
import { checkSpaceAccess, generateId, now, toIsoString } from '../../../shared/utils';
import { BadRequestError, NotFoundError, AppError, ErrorCodes } from '@takos/common/errors';
import { checkRunAccess } from './access';
import {
  persistAndEmitEvent,
} from '../../../application/services/execution/run-events';
import {
  deriveRunStatusFromTimelineEvents,
  loadRunObservation,
} from './observation';
import { registerRunCreateRoutes } from './create';
import { registerRunListRoutes } from './list';
import { buildSanitizedDOHeaders } from '../../../runtime/durable-objects/shared';
import type { BaseVariables } from '../shared/route-auth';

type RunRouteEnv = { Bindings: Env; Variables: BaseVariables };
type RunRouteApp = Hono<RunRouteEnv>;
import { zValidator } from '../zod-validator';

type ArtifactRow = {
  id: string;
  runId: string;
  accountId: string;
  type: string;
  title: string | null;
  content: string | null;
  fileId: string | null;
  metadata: string;
  createdAt: string | Date;
};

const VALID_ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  'code',
  'config',
  'doc',
  'patch',
  'report',
  'other',
]);

type RunNotifierNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: unknown, init?: unknown): Promise<Response> };
};

function artifactRowToApi(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    run_id: row.runId,
    space_id: row.accountId,
    type: row.type as ArtifactType,
    title: row.title,
    content: row.content,
    file_id: row.fileId,
    metadata: row.metadata,
    created_at: toIsoString(row.createdAt),
  };
}

function registerRunDetailRoutes(app: RunRouteApp): void {
  app.get('/runs/:id', async (c) => {
    const user = c.get('user');
    const runId = c.req.param('id');

    const access = await checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      throw new NotFoundError('Run');
    }

    return c.json({
      run: access.run,
      role: access.role,
    });
  });

  app.post('/runs/:id/cancel', async (c) => {
    const user = c.get('user');
    const runId = c.req.param('id');

    const access = await checkRunAccess(c.env.DB, runId, user.id, ['owner', 'admin', 'editor']);
    if (!access) {
      throw new NotFoundError('Run');
    }

    if (RUN_TERMINAL_STATUSES.has(access.run.status)) {
      throw new BadRequestError('Run is already finished');
    }

    const db = getDb(c.env.DB);
    const completedAt = now();
    await db.update(runs).set({ status: 'cancelled', completedAt }).where(eq(runs.id, runId));

    const cancellationPayload = buildTerminalPayload(runId, 'cancelled', {}, access.run.session_id ?? null);
    await persistAndEmitEvent(c.env, runId, 'cancelled', cancellationPayload, true);

    return c.json({ success: true });
  });

  app.get('/runs/:id/events',
    zValidator('query', z.object({ last_event_id: z.string().optional() })),
    async (c) => {
      const user = c.get('user');
      const runId = c.req.param('id');
      const lastEventId = Number.parseInt((c.req.valid('query' as never) as { last_event_id?: string }).last_event_id ?? '0', 10);

      if (!Number.isFinite(lastEventId) || lastEventId < 0) {
        throw new BadRequestError('Invalid last_event_id');
      }

      const access = await checkRunAccess(c.env.DB, runId, user.id);
      if (!access) {
        throw new NotFoundError('Run');
      }

      const observation = await loadRunObservation(c.env, runId, access.run.status, lastEventId);
      return c.json({
        events: observation.events,
        run_status: observation.runStatus,
      });
    },
  );

  app.get('/runs/:id/ws', async (c) => {
    const user = c.get('user');
    const runId = c.req.param('id');

    const access = await checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      throw new NotFoundError('Run');
    }

    if (c.req.header('Upgrade') !== 'websocket') {
      throw new AppError('Expected WebSocket upgrade', ErrorCodes.BAD_REQUEST, 426);
    }

    const namespace = c.env.RUN_NOTIFIER as unknown as RunNotifierNamespace;
    const id = namespace.idFromName(runId);
    const stub = namespace.get(id);
    const headers = buildSanitizedDOHeaders(c.req.raw.headers, { 'X-WS-Auth-Validated': 'true', 'X-WS-User-Id': user.id });

    const request = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
    });
    return await stub.fetch(request) as unknown as Response;
  });

  app.get('/runs/:id/replay', async (c) => {
    const user = c.get('user');
    const runId = c.req.param('id');
    const rawCursor = c.req.query('last_event_id') ?? c.req.query('after') ?? '0';
    const lastEventId = Number.parseInt(rawCursor, 10);

    if (!Number.isFinite(lastEventId) || lastEventId < 0) {
      throw new BadRequestError('Invalid last_event_id');
    }

    const access = await checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      throw new NotFoundError('Run');
    }

    const observation = await loadRunObservation(c.env, runId, access.run.status, lastEventId);
    return c.json({
      events: observation.events,
      run_status: observation.runStatus,
    });
  });
}

function registerRunArtifactRoutes(app: RunRouteApp): void {
  app.get('/runs/:id/artifacts', async (c) => {
    const user = c.get('user');
    const runId = c.req.param('id');

    const access = await checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      throw new NotFoundError('Run');
    }

    const db = getDb(c.env.DB);
    const rows = await db.select().from(artifacts).where(eq(artifacts.runId, runId)).orderBy(asc(artifacts.createdAt)).all();

    return c.json({
      artifacts: rows.map((row) => artifactRowToApi(row as unknown as ArtifactRow)),
    });
  });

  app.post('/runs/:id/artifacts',
    zValidator('json', z.object({
      type: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
      file_id: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    })),
    async (c) => {
      const user = c.get('user');
      const runId = c.req.param('id');
      const body = c.req.valid('json' as never) as {
        type: ArtifactType;
        title?: string;
        content?: string;
        file_id?: string;
        metadata?: Record<string, unknown>;
      };

      const access = await checkRunAccess(c.env.DB, runId, user.id, ['owner', 'admin', 'editor']);
      if (!access) {
        throw new NotFoundError('Run');
      }

      if (!VALID_ARTIFACT_TYPES.has(body.type)) {
        throw new BadRequestError('Invalid artifact type');
      }

      const db = getDb(c.env.DB);
      const created = await db.insert(artifacts).values({
        id: generateId(),
        runId,
        accountId: access.run.space_id,
        type: body.type,
        title: body.title ?? null,
        content: body.content ?? null,
        fileId: body.file_id ?? null,
        metadata: JSON.stringify(body.metadata ?? {}),
        createdAt: now(),
      }).returning().get();

      return c.json({
        artifact: artifactRowToApi(created as unknown as ArtifactRow),
      }, 201);
    },
  );

  app.get('/artifacts/:id', async (c) => {
    const user = c.get('user');
    const artifactId = c.req.param('id');
    const db = getDb(c.env.DB);
    const artifactRow = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).get();

    if (!artifactRow) {
      throw new NotFoundError('Artifact');
    }

    const access = await checkSpaceAccess(c.env.DB, artifactRow.accountId, user.id);
    if (!access) {
      throw new NotFoundError('Artifact');
    }

    return c.json({
      artifact: artifactRowToApi(artifactRow as unknown as ArtifactRow),
    });
  });
}

const router = new Hono<RunRouteEnv>() as RunRouteApp;

registerRunListRoutes(router);
registerRunCreateRoutes(router);
registerRunDetailRoutes(router);
registerRunArtifactRoutes(router);

export default router;
