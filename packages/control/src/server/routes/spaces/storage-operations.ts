import type { MiddlewareHandler } from 'hono';
import type { Context } from 'hono';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import type { OAuthContext } from '../../middleware/oauth-auth';
import { StorageError } from '../../../application/services/source/space-storage';
import { BadRequestError, NotFoundError, ConflictError, InternalError, BadGatewayError, PayloadTooLargeError } from 'takos-common/errors';
import { RateLimiters } from '../../../shared/utils/rate-limiter';

export const storageBulkLimiter = RateLimiters.sensitive();
export const MAX_BULK_OPERATION_ITEMS = 200;

export const INLINE_SAFE_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'application/pdf'];

export function requireOAuthScope(scope: string): MiddlewareHandler<AuthenticatedRouteEnv> {
  return async (c, next) => {
    // OAuth middleware may set 'oauth' on the context variables.
    // Access via generic get() since the type is not declared in AuthenticatedRouteEnv.
    const oauth = (c.get as (key: string) => unknown)('oauth') as OAuthContext | undefined;
    if (oauth && !oauth.scopes.includes(scope)) {
      return c.json({
        error: 'insufficient_scope',
        error_description: `Required scope: ${scope}`,
      }, 403);
    }
    await next();
  };
}

export function handleStorageError(_c: Context, err: unknown): never {
  if (err instanceof StorageError) {
    switch (err.code) {
      case 'NOT_FOUND':
        throw new NotFoundError(err.message.replace(/ not found$/, '') || 'Resource');
      case 'CONFLICT':
        throw new ConflictError(err.message);
      case 'TOO_LARGE':
        throw new PayloadTooLargeError(err.message);
      case 'STORAGE_ERROR':
        throw new BadGatewayError(err.message);
      case 'VALIDATION':
        throw new BadRequestError(err.message);
    }
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  throw new InternalError(message);
}
