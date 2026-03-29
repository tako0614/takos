import type { Context, MiddlewareHandler } from 'hono';
import type { Env, User, SpaceRole } from '../../../shared/types';
import type { SpaceAccess } from '../../../application/services/identity/space-access';
import { checkSpaceAccess } from '../../../application/services/identity/space-access';
import { AppError, ErrorCodes, NotFoundError, InternalError, AuthenticationError, BadRequestError as BadRequestErr } from 'takos-common/errors';

// Re-export Error classes and types from takos-common/errors (canonical location)
export {
  ErrorCodes,
  type ErrorCode,
  AppError,
  BadRequestError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  InternalError,
  ServiceUnavailableError,
  isAppError,
  normalizeError,
  logError,
  type ValidationErrorDetail,
  type ErrorResponse,
} from 'takos-common/errors';

// Re-export non-deprecated helpers from error-response
export { oauth2Error, type OAuth2ErrorResponse } from '../../../shared/utils/error-response';

/**
 * Base Variables type that all authenticated routes must have.
 * Routes may extend this with additional variables.
 */
export interface BaseVariables {
  user: User;
}

/** Route env for endpoints requiring authentication (user is required). */
export type AuthenticatedRouteEnv = {
  Bindings: Env;
  Variables: BaseVariables;
};

/** Route env for endpoints where authentication is optional. */
export type OptionalAuthRouteEnv = {
  Bindings: Env;
  Variables: { user?: User };
};

/** Route env for fully public endpoints (no user context). */
export type PublicRouteEnv = {
  Bindings: Env;
  Variables: Record<string, never>;
};

/**
 * AppContext type for route handlers.
 * TVariables must include at least the BaseVariables (user: User).
 * This ensures helper functions can safely access c.get('user').
 */
export type AppContext<TVariables extends BaseVariables = BaseVariables> = Context<{
  Bindings: Env;
  Variables: TVariables;
}>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtx = Context<any>;

export async function requireSpaceAccess(
  c: AnyCtx,
  spaceId: string,
  userId: string,
  roles?: Array<'owner' | 'admin' | 'editor' | 'viewer'>,
  message = 'Space not found',
  status = 404
) {
  const access = await checkSpaceAccess(c.env.DB, spaceId, userId, roles);
  if (!access) {
    throw new AppError(message, ErrorCodes.NOT_FOUND, status);
  }
  return access;
}

export function getRequestedSpaceIdentifier(c: AnyCtx): string | null {
  const value = c.req.header('X-Takos-Space-Id');
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function requireTenantSource(
  c: AnyCtx,
  message = 'Storage not configured',
) {
  if (!c.env.TENANT_SOURCE) {
    throw new InternalError(message);
  }
  return c.env.TENANT_SOURCE;
}

export async function parseJsonBody<T>(c: AnyCtx, fallback: T): Promise<T>;
export async function parseJsonBody<T>(c: AnyCtx, fallback?: T | null): Promise<T | null>;
export async function parseJsonBody<T>(
  c: AnyCtx,
  fallback: T | null = null
): Promise<T | null> {
  try {
    const raw = await c.req.text();
    if (!raw || raw.trim().length === 0) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    // Malformed JSON body -- return null so callers can handle gracefully
    return null;
  }
}

// ---------------------------------------------------------------------------
// Space access middleware
// ---------------------------------------------------------------------------

/**
 * Variables set by the `spaceAccess()` middleware.
 *
 * After the middleware runs, route handlers can call:
 *   - `c.get('spaceId')` for the resolved (canonical) space ID
 *   - `c.get('access')` for the full `SpaceAccess` object (space + membership)
 *
 * Always combine with `BaseVariables` so `c.get('user')` is also available.
 */
export interface SpaceAccessVariables extends BaseVariables {
  spaceId: string;
  access: SpaceAccess;
}

/** Route env for endpoints that go through the `spaceAccess()` middleware. */
export type SpaceAccessRouteEnv = {
  Bindings: Env;
  Variables: SpaceAccessVariables;
};

// Re-export SpaceAccess so consumers don't need an extra import
export type { SpaceAccess };

/**
 * Resolve the space identifier from the request.
 *
 * Checks, in order:
 * 1. URL params `:spaceId` or `:workspaceId`
 * 2. Query params `spaceId` or `space_id`
 *
 * Returns `null` if none found.
 */
function resolveSpaceIdentifier(c: AnyCtx): string | null {
  // URL path params
  const paramSpaceId = c.req.param('spaceId') || c.req.param('workspaceId');
  if (paramSpaceId) return paramSpaceId;

  // Query params
  const querySpaceId = c.req.query('spaceId') || c.req.query('space_id');
  if (querySpaceId) return querySpaceId;

  return null;
}

export interface SpaceAccessOptions {
  /** Required roles for access. When omitted any role is accepted. */
  roles?: SpaceRole[];
  /** Error message on access failure. */
  message?: string;
  /** HTTP status code on access failure (default: 404). */
  status?: number;
}

/**
 * Hono middleware factory that extracts user + spaceId and validates
 * space membership in one step.
 *
 * Replaces the repeated boilerplate:
 * ```ts
 * const user = c.get('user');
 * const spaceId = c.req.param('spaceId');
 * const access = await requireSpaceAccess(c, spaceId, user.id, roles);
 * ```
 *
 * Usage:
 * ```ts
 * app.get('/spaces/:spaceId/things', spaceAccess(), async (c) => {
 *   const { space } = c.get('access');
 *   // ...
 * });
 *
 * app.post('/spaces/:spaceId/things', spaceAccess({ roles: ['owner', 'admin', 'editor'] }), async (c) => {
 *   const { space } = c.get('access');
 *   // ...
 * });
 * ```
 */
export function spaceAccess(
  options?: SpaceAccessOptions | SpaceRole[],
): MiddlewareHandler<SpaceAccessRouteEnv> {
  const opts: SpaceAccessOptions = Array.isArray(options)
    ? { roles: options }
    : (options ?? {});

  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      throw new AuthenticationError();
    }

    const spaceIdentifier = resolveSpaceIdentifier(c);
    if (!spaceIdentifier) {
      throw new BadRequestErr('spaceId is required');
    }

    const access = await requireSpaceAccess(
      c,
      spaceIdentifier,
      user.id,
      opts.roles,
      opts.message,
      opts.status,
    );

    c.set('spaceId', access.space.id);
    c.set('access', access);

    await next();
  };
}
