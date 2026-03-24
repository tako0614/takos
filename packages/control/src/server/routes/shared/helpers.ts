import type { Context } from 'hono';
import type { Env, User } from '../../../shared/types';
import { checkWorkspaceAccess } from '../../../shared/utils';

// Re-export HTTP error response functions from utils/error-response (canonical location)
export {
  errorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  validationError,
  internalError,
  serviceUnavailable,
  rateLimited,
  handleDbError,
  type ErrorResponse,
  type AnyAppContext,
} from '../../../shared/utils/error-response';

// Import for local use
import { errorResponse } from '../../../shared/utils/error-response';
import type { AnyAppContext } from '../../../shared/utils/error-response';

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

export async function requireWorkspaceAccess(
  c: AnyAppContext,
  workspaceId: string,
  userId: string,
  roles?: Array<'owner' | 'admin' | 'editor' | 'viewer'>,
  message = 'Workspace not found',
  status = 404
) {
  const access = await checkWorkspaceAccess(c.env.DB, workspaceId, userId, roles);
  if (!access) {
    return errorResponse(c, status, message);
  }
  return access;
}

export function getRequestedSpaceIdentifier(c: AnyAppContext): string | null {
  const value = c.req.header('X-Takos-Space-Id');
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function requireTenantSource(
  c: AnyAppContext,
  message = 'Storage not configured',
  status = 500
) {
  if (!c.env.TENANT_SOURCE) {
    return errorResponse(c, status, message);
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

export async function parseJsonBody<T>(c: AnyAppContext, fallback: T): Promise<T>;
export async function parseJsonBody<T>(c: AnyAppContext, fallback?: T | null): Promise<T | null>;
export async function parseJsonBody<T>(
  c: AnyAppContext,
  fallback: T | null = null
): Promise<T | null> {
  try {
    const raw = await c.req.text();
    if (!raw || raw.trim().length === 0) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
