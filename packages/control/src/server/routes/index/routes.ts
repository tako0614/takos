import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../../../shared/types/index.ts';
import type { BaseVariables } from '../route-auth.ts';
import { InMemoryRateLimiter } from '../../../shared/utils/index.ts';
import { parseJsonBody } from '../route-auth.ts';
import {
  handleIndexFile,
  handleIndexStatus,
  handleRebuildIndex,
  handleVectorizeIndex,
} from './index-handlers.ts';
import { handleGraphNeighbors } from './graph.ts';
import { BadRequestError } from 'takos-common/errors';

const indexRoutes = new Hono<{ Bindings: Env; Variables: BaseVariables }>();

const expensiveIndexRateLimiter = new InMemoryRateLimiter({
  maxRequests: 5,
  windowMs: 15 * 60 * 1000,
  message: 'Too many indexing requests. Please wait before triggering another reindex.',
  keyGenerator: (c: Context) => {
    const user = c.get('user') as User | undefined;
    const spaceId = c.req.param('spaceId');
    return `index:${user?.id || 'anon'}:${spaceId || 'unknown'}`;
  },
});

indexRoutes.get('/spaces/:spaceId/index/status', handleIndexStatus);

indexRoutes.post('/spaces/:spaceId/index/vectorize', expensiveIndexRateLimiter.middleware(), async (c) => {
  const body = await parseJsonBody<{
    force_reindex?: boolean;
  }>(c, {});
  if (body === null) {
    throw new BadRequestError('Invalid JSON body');
  }
  return handleVectorizeIndex(c, body);
});

indexRoutes.post('/spaces/:spaceId/index/rebuild', expensiveIndexRateLimiter.middleware(), handleRebuildIndex);

indexRoutes.post('/spaces/:spaceId/index/file', async (c) => {
  const body = await parseJsonBody<{ path: string }>(c);
  return handleIndexFile(c, body);
});

indexRoutes.get('/spaces/:spaceId/graph/neighbors', handleGraphNeighbors);

export default indexRoutes;
