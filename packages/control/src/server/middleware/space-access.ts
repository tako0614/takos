/**
 * Space Access Helpers.
 *
 * Provides `requireSpaceAccessOrThrow()` which eliminates the
 * repeated `if (access instanceof Response) return access` pattern
 * found in 20+ route handlers.
 *
 * Before:
 * ```ts
 * const access = await requireSpaceAccess(c, spaceId, user.id, ['editor']);
 * if (access instanceof Response) return access;
 * // access is SpaceAccess here
 * ```
 *
 * After:
 * ```ts
 * const access = await requireSpaceAccessOrThrow(c, spaceId, user.id, ['editor']);
 * // access is always SpaceAccess -- throws SpaceAccessError on failure
 * ```
 *
 * Route handlers can catch `SpaceAccessError` at the top level and
 * let the global error handler produce the standard response, or use
 * `withSpaceAccessGuard()` to install a wrapper that does that
 * automatically.
 */

import type { Context } from 'hono';
import type { SpaceAccess } from '../../application/services/identity/space-access';
import type { SpaceRole } from '../../shared/types';
import { checkSpaceAccess } from '../../application/services/identity/space-access';
import { AppError } from 'takos-common/errors';
import type { ErrorCode } from 'takos-common/errors';

/** Map HTTP status codes to the appropriate AppError subclass. */
const STATUS_TO_ERROR_CODE: Record<number, ErrorCode> = {
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
};

/**
 * Error thrown when space access is denied.
 *
 * Extends `AppError` so the global error handler can produce the
 * standard nested error response automatically.
 */
export class SpaceAccessError extends AppError {
  constructor(statusCode: number, message: string) {
    super(
      message,
      STATUS_TO_ERROR_CODE[statusCode] ?? 'NOT_FOUND',
      statusCode,
    );
    this.name = 'SpaceAccessError';
  }
}


/**
 * Require space access, throwing {@link SpaceAccessError} on failure.
 *
 * This is a throwing wrapper around the existing `requireSpaceAccess`
 * helper from `server/routes/route-auth.ts`.  It calls
 * `checkSpaceAccess` directly and, on failure, throws a
 * `SpaceAccessError` (an `AppError` subclass) which the global error
 * handler converts to the standard nested error response.
 *
 * @param c           - Hono request context (needs `env.DB`).
 * @param spaceId     - ID or slug of the space to check.
 * @param userId      - ID of the requesting user.
 * @param roles       - optional set of roles the user must hold.
 * @param message     - error message on failure (default: `"Space not found"`).
 * @param status      - HTTP status on failure (default: `404`).
 * @returns the validated {@link SpaceAccess} (space + membership).
 * @throws {SpaceAccessError} when access is denied.
 *
 * @example
 * ```ts
 * app.get('/spaces/:id/settings', requireAuth, async (c) => {
 *   const user = c.get('user');
 *   const { space, membership } = await requireSpaceAccessOrThrow(
 *     c,
 *     c.req.param('id'),
 *     user.id,
 *     ['owner', 'admin'],
 *   );
 *   // space and membership are guaranteed valid here
 * });
 * ```
 */
export async function requireSpaceAccessOrThrow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: Context<any>,
  spaceId: string,
  userId: string,
  roles?: SpaceRole[],
  message = 'Space not found',
  status = 404,
): Promise<SpaceAccess> {
  const access = await checkSpaceAccess(c.env.DB, spaceId, userId, roles);
  if (!access) {
    throw new SpaceAccessError(status, message);
  }
  return access;
}


/**
 * Convenience predicate for use in error-handling middleware or
 * top-level try/catch blocks.
 *
 * @example
 * ```ts
 * try {
 *   const access = await requireSpaceAccessOrThrow(c, id, uid);
 *   // ...
 * } catch (err) {
 *   if (isSpaceAccessError(err)) throw err;
 *   throw err;
 * }
 * ```
 */
export function isSpaceAccessError(err: unknown): err is SpaceAccessError {
  return err instanceof SpaceAccessError;
}

