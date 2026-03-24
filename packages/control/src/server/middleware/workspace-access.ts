/**
 * Workspace Access Helpers.
 *
 * Provides `requireWorkspaceAccessOrThrow()` which eliminates the
 * repeated `if (access instanceof Response) return access` pattern
 * found in 20+ route handlers.
 *
 * Before:
 * ```ts
 * const access = await requireWorkspaceAccess(c, spaceId, user.id, ['editor']);
 * if (access instanceof Response) return access;
 * // access is WorkspaceAccess here
 * ```
 *
 * After:
 * ```ts
 * const access = await requireWorkspaceAccessOrThrow(c, spaceId, user.id, ['editor']);
 * // access is always WorkspaceAccess -- throws WorkspaceAccessError on failure
 * ```
 *
 * Route handlers can catch `WorkspaceAccessError` at the top level and
 * return its `.response`, or use `withWorkspaceAccessGuard()` to install
 * a wrapper that does that automatically.
 */

import type { WorkspaceAccess } from '../../shared/utils/workspace';
import type { WorkspaceRole } from '../../shared/types';
import { checkWorkspaceAccess } from '../../shared/utils/workspace';
import { errorResponse, type AnyAppContext } from '../../shared/utils/error-response';

/**
 * Error thrown when workspace access is denied.
 *
 * Carries the pre-built `Response` so callers (or a top-level error
 * handler) can return it directly without re-constructing the body.
 */
export class WorkspaceAccessError extends Error {
  /** HTTP status code of the denied response. */
  readonly status: number;
  /** Pre-built Hono `Response` that can be returned to the client as-is. */
  readonly response: Response;

  constructor(status: number, message: string, response: Response) {
    super(message);
    this.name = 'WorkspaceAccessError';
    this.status = status;
    this.response = response;
  }
}

/**
 * Require workspace access, throwing {@link WorkspaceAccessError} on failure.
 *
 * This is a throwing wrapper around the existing `requireWorkspaceAccess`
 * helper from `server/routes/shared/helpers.ts`.  It calls
 * `checkWorkspaceAccess` directly and, on failure, constructs an error
 * response via `errorResponse` and throws it as a `WorkspaceAccessError`.
 *
 * @param c           - Hono request context (needs `env.DB`).
 * @param workspaceId - ID or slug of the workspace to check.
 * @param userId      - ID of the requesting user.
 * @param roles       - optional set of roles the user must hold.
 * @param message     - error message on failure (default: `"Workspace not found"`).
 * @param status      - HTTP status on failure (default: `404`).
 * @returns the validated {@link WorkspaceAccess} (workspace + member).
 * @throws {WorkspaceAccessError} when access is denied.
 *
 * @example
 * ```ts
 * app.get('/spaces/:id/settings', requireAuth, async (c) => {
 *   const user = c.get('user');
 *   const { workspace, member } = await requireWorkspaceAccessOrThrow(
 *     c,
 *     c.req.param('id'),
 *     user.id,
 *     ['owner', 'admin'],
 *   );
 *   // workspace and member are guaranteed valid here
 * });
 * ```
 */
export async function requireWorkspaceAccessOrThrow(
  c: AnyAppContext,
  workspaceId: string,
  userId: string,
  roles?: WorkspaceRole[],
  message = 'Workspace not found',
  status = 404,
): Promise<WorkspaceAccess> {
  const access = await checkWorkspaceAccess(c.env.DB, workspaceId, userId, roles);
  if (!access) {
    const response = errorResponse(c, status, message);
    throw new WorkspaceAccessError(status, message, response);
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
 *   const access = await requireWorkspaceAccessOrThrow(c, id, uid);
 *   // ...
 * } catch (err) {
 *   if (isWorkspaceAccessError(err)) return err.response;
 *   throw err;
 * }
 * ```
 */
export function isWorkspaceAccessError(err: unknown): err is WorkspaceAccessError {
  return err instanceof WorkspaceAccessError;
}
