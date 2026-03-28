import type { MiddlewareHandler } from 'hono';
import type { Env } from '../../shared/types';
import { isValidOpaqueId } from '../../shared/utils/db-guards';
import { BadRequestError } from '@takoserver/common/errors';
import { logWarn } from '../../shared/utils/logger';

// Route params that must be opaque IDs
const OPAQUE_ID_PARAM_NAMES = new Set([
  'id',
  'artifactId',
  'assetId',
  'buildId',
  'clientId',
  'commitId',
  'deploymentId',
  'domainId',
  'fileId',
  'jobId',
  'memoryId',
  'packageId',
  'projectId',
  'repoId',
  'reminderId',
  'runId',
  'sessionId',
  'serviceId',
  'taskId',
  'threadId',
  'tokenId',
  'toolId',
  'userId',
  'workerId',
  'spaceId',
]);

const SPACE_ROUTE_PARAM_PATTERN = /^(?:me|[a-z0-9](?:[a-z0-9-]{0,31})|[A-Za-z0-9_-]{1,128})$/;

function isValidRouteParam(key: string, value: string): boolean {
  if (key === 'spaceId') {
    return SPACE_ROUTE_PARAM_PATTERN.test(value);
  }
  return isValidOpaqueId(value);
}

// Fail-close guard: rejects malformed route params before they reach the database
export const validateApiOpaqueRouteParams: MiddlewareHandler<{
  Bindings: Env;
}> = async (c, next) => {
  const params = c.req.param() as Record<string, string>;
  for (const [key, value] of Object.entries(params)) {
    if (!OPAQUE_ID_PARAM_NAMES.has(key)) continue;
    if (isValidRouteParam(key, value)) continue;

    logWarn(`Rejected malformed route parameter "${key}" on ${c.req.method} ${c.req.path}`, { module: 'middleware/param-validation' });
    throw new BadRequestError(`Invalid route parameter: ${key}`);
  }

  await next();
};
