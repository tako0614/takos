import { z } from 'zod';
import { checkThreadAccess } from '../../../application/services/threads/thread-service';
import { parseLimit } from '../shared/route-auth';
import type { Hono } from 'hono';
import type { Env } from '../../../shared/types';
import type { BaseVariables } from '../shared/route-auth';
import { NotFoundError, BadRequestError } from 'takos-common/errors';

type RunRouteApp = Hono<{ Bindings: Env; Variables: BaseVariables }>;
import { zValidator } from '../zod-validator';
import { getDb } from '../../../infra/db';
import { runs } from '../../../infra/db/schema';
import { eq, and, or, lt, desc, inArray } from 'drizzle-orm';
import { asRunRow, runRowToApi } from '../../../application/services/runs/run-serialization';
import { toIsoString } from '../../../shared/utils';

const RUN_LIST_CURSOR_DELIMITER = ',';
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function encodeRunListCursor(createdAt: string, runId: string): string {
  return `${createdAt}${RUN_LIST_CURSOR_DELIMITER}${runId}`;
}

function parseRunListCursor(cursor: string): { createdAt: string; runId: string | null } | null {
  const delimiterIndex = cursor.indexOf(RUN_LIST_CURSOR_DELIMITER);
  const hasCompositeToken = delimiterIndex >= 0;
  const rawCreatedAt = hasCompositeToken ? cursor.slice(0, delimiterIndex) : cursor;
  const rawRunId = hasCompositeToken ? cursor.slice(delimiterIndex + 1) : null;

  const ts = Date.parse(rawCreatedAt);
  if (!Number.isFinite(ts)) {
    return null;
  }

  if (rawRunId !== null && !OPAQUE_ID_PATTERN.test(rawRunId)) {
    return null;
  }

  return {
    createdAt: new Date(ts).toISOString(),
    runId: rawRunId,
  };
}

export function registerRunListRoutes(app: RunRouteApp) {
  app.get('/threads/:threadId/runs',
    zValidator('query', z.object({
      active_only: z.string().optional(),
      limit: z.string().optional(),
      cursor: z.string().optional(),
    })),
    async (c) => {
      const user = c.get('user');
      const threadId = c.req.param('threadId');
      const runsQuery = c.req.valid('query' as never) as { active_only?: string; limit?: string; cursor?: string };
      const activeOnly = runsQuery.active_only === '1';
      const limit = parseLimit(runsQuery.limit, 50, 200);
      const cursor = runsQuery.cursor;

      const access = await checkThreadAccess(c.env.DB, threadId, user.id);
      if (!access) {
        throw new NotFoundError('Thread');
      }

      let parsedCursor: { createdAt: string; runId: string | null } | null = null;
      if (cursor) {
        parsedCursor = parseRunListCursor(cursor);
        if (!parsedCursor) {
          throw new BadRequestError('Invalid cursor');
        }
      }

      const db = getDb(c.env.DB);
      const conditions = [eq(runs.threadId, threadId)];
      if (activeOnly) {
        conditions.push(inArray(runs.status, ['pending', 'queued', 'running']));
      }
      if (parsedCursor?.createdAt) {
        if (parsedCursor.runId) {
          conditions.push(
            or(
              lt(runs.createdAt, parsedCursor.createdAt),
              and(
                eq(runs.createdAt, parsedCursor.createdAt),
                lt(runs.id, parsedCursor.runId),
              ),
            )!
          );
        } else {
          conditions.push(lt(runs.createdAt, parsedCursor.createdAt));
        }
      }

      const result = await db.select().from(runs)
        .where(and(...conditions))
        .orderBy(desc(runs.createdAt), desc(runs.id))
        .limit(limit)
        .all();

      const runsList = result.map((row) => runRowToApi(asRunRow({ ...row, spaceId: row.accountId })));
      const lastRow = result[result.length - 1];
      const nextCursor = result.length === limit && lastRow
        ? encodeRunListCursor(toIsoString(lastRow.createdAt), lastRow.id)
        : null;
      const normalizedCursor = parsedCursor
        ? (parsedCursor.runId
          ? encodeRunListCursor(parsedCursor.createdAt, parsedCursor.runId)
          : parsedCursor.createdAt)
        : null;

      return c.json({
        runs: runsList,
        limit,
        active_only: activeOnly,
        cursor: normalizedCursor,
        next_cursor: nextCursor,
      });
    },
  );
}
