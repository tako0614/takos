import type { Context } from 'hono';
import type { Env, User } from '../../../shared/types';
import { checkSpaceAccess } from '../../../shared/utils';
import { AppError, ErrorCodes, NotFoundError, InternalError } from 'takos-common/errors';

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

export function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function parseOffset(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
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
