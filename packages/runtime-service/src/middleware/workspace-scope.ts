import type { Context, Next } from 'hono';
import { forbidden } from '@takos/common/middleware/hono';

export const WORKSPACE_SCOPE_MISMATCH_ERROR = 'Token workspace scope does not match requested workspace';

export function getWorkspaceIdFromPath(c: Context): string | null {
  const pathParts = c.req.path.split('/').filter(Boolean);
  if (pathParts[0] !== 'repos' || pathParts.length < 3) {
    return null;
  }
  const spaceId = pathParts[1];
  if (typeof spaceId !== 'string' || spaceId.length === 0) {
    return null;
  }
  return spaceId;
}
function isProvidedWorkspaceId(spaceId: unknown): boolean {
  return spaceId !== undefined && spaceId !== null && spaceId !== '';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function getWorkspaceIdFromBody(c: Context, field: 'spaceId' | 'space_id'): string | null {
  const body = c.get('parsedBody') as Record<string, unknown> | undefined;
  const spaceId = body?.[field];
  return isNonEmptyString(spaceId) ? spaceId : null;
}

export function collectRequestedWorkspaceIds(spaceIds: readonly unknown[]): string[] {
  return [...new Set(spaceIds.filter(isNonEmptyString))];
}

export function getScopedWorkspaceId(c: Context): string | undefined {
  const payload = c.get('serviceToken');
  if (!payload) {
    return undefined;
  }
  return typeof payload.scope_space_id === 'string'
    ? payload.scope_space_id
    : undefined;
}

export function hasWorkspaceScopeMismatch(c: Context, spaceId: unknown): boolean {
  if (!isProvidedWorkspaceId(spaceId)) {
    return false;
  }
  const scopedWorkspaceId = getScopedWorkspaceId(c);
  return typeof scopedWorkspaceId === 'string' && scopedWorkspaceId !== spaceId;
}

export function hasAnyWorkspaceScopeMismatch(c: Context, spaceIds: readonly unknown[]): boolean {
  for (const spaceId of spaceIds) {
    if (hasWorkspaceScopeMismatch(c, spaceId)) {
      return true;
    }
  }
  return false;
}

/**
 * Creates a Hono middleware that enforces workspace scope by extracting
 * workspace IDs from the context using the provided extractor function.
 *
 * If a single non-empty workspace ID is found and it mismatches the token scope,
 * the request is rejected with 403. If multiple conflicting workspace IDs are
 * found, the request is also rejected.
 *
 * Note: expects the request body to already be parsed and stored in
 * c.get('parsedBody') by an upstream middleware (see index.ts).
 */
export function enforceWorkspaceScopeMiddleware(
  extractSpaceIds: (c: Context) => readonly unknown[]
): (c: Context, next: Next) => Promise<Response | void> {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const spaceIds = collectRequestedWorkspaceIds(extractSpaceIds(c));

    if (spaceIds.length === 0) {
      await next();
      return;
    }

    if (new Set(spaceIds).size > 1) {
      return forbidden(c, 'Conflicting workspace identifiers in request');
    }

    if (hasAnyWorkspaceScopeMismatch(c, spaceIds)) {
      return forbidden(c, WORKSPACE_SCOPE_MISMATCH_ERROR);
    }

    await next();
  };
}
