import type { Context, Next } from 'hono';
import { forbidden } from '@takos/common/middleware/hono';

export const SPACE_SCOPE_MISMATCH_ERROR = 'Token workspace scope does not match requested workspace';

/** @deprecated Use {@link SPACE_SCOPE_MISMATCH_ERROR} instead. */
export const WORKSPACE_SCOPE_MISMATCH_ERROR = SPACE_SCOPE_MISMATCH_ERROR;

export function getSpaceIdFromPath(c: Context): string | null {
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

/** @deprecated Use {@link getSpaceIdFromPath} instead. */
export const getWorkspaceIdFromPath = getSpaceIdFromPath;

function isProvidedSpaceId(spaceId: unknown): boolean {
  return spaceId !== undefined && spaceId !== null && spaceId !== '';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function getSpaceIdFromBody(c: Context, field: 'spaceId' | 'space_id'): string | null {
  const body = c.get('parsedBody') as Record<string, unknown> | undefined;
  const spaceId = body?.[field];
  return isNonEmptyString(spaceId) ? spaceId : null;
}

/** @deprecated Use {@link getSpaceIdFromBody} instead. */
export const getWorkspaceIdFromBody = getSpaceIdFromBody;

export function collectRequestedSpaceIds(spaceIds: readonly unknown[]): string[] {
  return [...new Set(spaceIds.filter(isNonEmptyString))];
}

/** @deprecated Use {@link collectRequestedSpaceIds} instead. */
export const collectRequestedWorkspaceIds = collectRequestedSpaceIds;

export function getScopedSpaceId(c: Context): string | undefined {
  const payload = c.get('serviceToken');
  if (!payload) {
    return undefined;
  }
  return typeof payload.scope_space_id === 'string'
    ? payload.scope_space_id
    : undefined;
}

/** @deprecated Use {@link getScopedSpaceId} instead. */
export const getScopedWorkspaceId = getScopedSpaceId;

export function hasSpaceScopeMismatch(c: Context, spaceId: unknown): boolean {
  if (!isProvidedSpaceId(spaceId)) {
    return false;
  }
  const scopedSpaceId = getScopedSpaceId(c);
  return typeof scopedSpaceId === 'string' && scopedSpaceId !== spaceId;
}

/** @deprecated Use {@link hasSpaceScopeMismatch} instead. */
export const hasWorkspaceScopeMismatch = hasSpaceScopeMismatch;

export function hasAnySpaceScopeMismatch(c: Context, spaceIds: readonly unknown[]): boolean {
  for (const spaceId of spaceIds) {
    if (hasSpaceScopeMismatch(c, spaceId)) {
      return true;
    }
  }
  return false;
}

/** @deprecated Use {@link hasAnySpaceScopeMismatch} instead. */
export const hasAnyWorkspaceScopeMismatch = hasAnySpaceScopeMismatch;

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
  extractSpaceIds: (c: Context) => readonly unknown[]
): (c: Context, next: Next) => Promise<Response | void> {
  return async (c: Context, next: Next): Promise<Response | void> => {
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

/** @deprecated Use {@link enforceSpaceScopeMiddleware} instead. */
export const enforceWorkspaceScopeMiddleware = enforceSpaceScopeMiddleware;
