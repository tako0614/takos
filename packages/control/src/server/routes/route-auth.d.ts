import type { Context, MiddlewareHandler } from 'hono';
import type { Env, User, SpaceRole } from '../../../shared/types';
import type { SpaceAccess } from '../../../application/services/identity/space-access';
export { ErrorCodes, type ErrorCode, AppError, BadRequestError, AuthenticationError, AuthorizationError, NotFoundError, ConflictError, ValidationError, RateLimitError, InternalError, ServiceUnavailableError, isAppError, normalizeError, logError, type ValidationErrorDetail, type ErrorResponse, } from 'takos-common/errors';
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
    Variables: {
        user?: User;
    };
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
type AnyCtx = Context<any>;
export declare function requireSpaceAccess(c: AnyCtx, spaceId: string, userId: string, roles?: Array<'owner' | 'admin' | 'editor' | 'viewer'>, message?: string, status?: number): Promise<any>;
export declare function getRequestedSpaceIdentifier(c: AnyCtx): string | null;
export declare function requireTenantSource(c: AnyCtx, message?: string): any;
export declare function parseJsonBody<T>(c: AnyCtx, fallback: T): Promise<T>;
export declare function parseJsonBody<T>(c: AnyCtx, fallback?: T | null): Promise<T | null>;
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
export type { SpaceAccess };
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
export declare function spaceAccess(options?: SpaceAccessOptions | SpaceRole[]): MiddlewareHandler<SpaceAccessRouteEnv>;
//# sourceMappingURL=route-auth.d.ts.map