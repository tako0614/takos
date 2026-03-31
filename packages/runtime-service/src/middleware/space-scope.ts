import type { Context, Next } from 'hono';
import type { RuntimeEnv } from '../types/hono.d.ts';
import { forbidden } from 'takos-common/middleware/hono';

export const SPACE_SCOPE_MISMATCH_ERROR = 'Token workspace scope does not match requested workspace';

export function getSpaceIdFromPath(c: Context<RuntimeEnv>): string | null {
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

function isProvidedSpaceId(spaceId: unknown): boolean {
  return spaceId !== undefined && spaceId !== null && spaceId !== '';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function getSpaceIdFromBody(c: Context<RuntimeEnv>, field: 'spaceId' | 'space_id'): string | null {
  const body = c.get('parsedBody') as Record<string, unknown> | undefined;
  const spaceId = body?.[field];
  return isNonEmptyString(spaceId) ? spaceId : null;
}

export function collectRequestedSpaceIds(spaceIds: readonly unknown[]): string[] {
  return [...new Set(spaceIds.filter(isNonEmptyString))];
}

export function getScopedSpaceId(c: Context<RuntimeEnv>): string | undefined {
  const payload = c.get('serviceToken');
  if (!payload) {
    return undefined;
  }
  return typeof payload.scope_space_id === 'string'
    ? payload.scope_space_id
    : undefined;
}

export function hasSpaceScopeMismatch(c: Context<RuntimeEnv>, spaceId: unknown): boolean {
  if (!isProvidedSpaceId(spaceId)) {
    return false;
  }
  const scopedSpaceId = getScopedSpaceId(c);
  return typeof scopedSpaceId === 'string' && scopedSpaceId !== spaceId;
}

export function hasAnySpaceScopeMismatch(c: Context<RuntimeEnv>, spaceIds: readonly unknown[]): boolean {
  for (const spaceId of spaceIds) {
    if (hasSpaceScopeMismatch(c, spaceId)) {
      return true;
    }
  }
  return false;
}

/**
 * Creates a Hono middleware that enforces space scope by extracting
 * space IDs from the context using the provided extractor function.
 *
 * If a single non-empty space ID is found and it mismatches the token scope,
 * the request is rejected with 403. If multiple conflicting space IDs are
 * found, the request is also rejected.
 *
 * Note: expects the request body to already be parsed and stored in
 * c.get('parsedBody') by an upstream middleware (see index.ts).
 */
export function enforceSpaceScopeMiddleware(
  extractSpaceIds: (c: Context<RuntimeEnv>) => readonly unknown[]
): (c: Context<RuntimeEnv>, next: Next) => Promise<Response | void> {
  return async (c: Context<RuntimeEnv>, next: Next): Promise<Response | void> => {
    const spaceIds = collectRequestedSpaceIds(extractSpaceIds(c));

    if (spaceIds.length === 0) {
      await next();
      return;
    }

    if (new Set(spaceIds).size > 1) {
      return forbidden(c, 'Conflicting workspace identifiers in request');
    }

    if (hasAnySpaceScopeMismatch(c, spaceIds)) {
      return forbidden(c, SPACE_SCOPE_MISMATCH_ERROR);
    }

    await next();
  };
}
