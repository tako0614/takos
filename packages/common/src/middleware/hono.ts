/**
 * Hono Middleware for takos-runtime
 *
 * Provides:
 * - Service-to-service JWT authentication (RS256)
 * - Consistent error handling
 */

import type { Context, Next, Env, ErrorHandler } from 'hono';
import {
  verifyServiceToken,
  type ServiceTokenPayloadWithClaims,
} from '../jwt.js';

export type { ServiceTokenPayloadWithClaims };
import {
  AppError,
  AuthenticationError,
  ErrorCodes,
  InternalError,
  isAppError,
  logError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  type ErrorCode,
  type ErrorResponse,
} from '../errors.js';

// =============================================================================
// Context variable types for Hono
// =============================================================================

/**
 * Environment bindings for service token middleware.
 * Use this as a type parameter for Hono to get typed context variables.
 *
 * Usage:
 * ```typescript
 * import type { ServiceTokenEnv } from '@takos/common/middleware/hono';
 * const app = new Hono<ServiceTokenEnv>();
 * ```
 */
export interface ServiceTokenEnv extends Env {
  Variables: {
    serviceToken: ServiceTokenPayloadWithClaims;
    serviceAuthMethod: 'jwt';
  };
}

// =============================================================================
// Service Token Authentication Middleware
// =============================================================================

/**
 * Configuration for service token middleware
 */
export interface ServiceTokenConfig {
  /** Public key for JWT verification (PEM format) */
  jwtPublicKey?: string;
  /** Expected issuer for JWT tokens (required when jwtPublicKey is set) */
  expectedIssuer?: string;
  /** Expected audience for JWT tokens (required when jwtPublicKey is set) */
  expectedAudience?: string;
  /** Paths to skip authentication (e.g., health checks) */
  skipPaths?: string[];
  /** Clock tolerance in seconds (default: 30) */
  clockToleranceSeconds?: number;
}

/**
 * Extract service token from Authorization header.
 */
export function getServiceTokenFromHeader(c: Context): string | null {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return null;
}

/**
 * Check if the token looks like a JWT (has 3 parts separated by dots)
 */
function isJwtFormat(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3;
}

/**
 * Create Hono middleware for service token authentication.
 * Only RS256 JWTs are accepted.
 *
 * @param config - Configuration for the middleware
 * @returns Hono middleware function
 *
 * Usage:
 * ```typescript
 * import { createServiceTokenMiddleware } from '@takos/common/middleware/hono';
 *
 * const app = new Hono<ServiceTokenEnv>();
 * app.use('*', createServiceTokenMiddleware({ jwtPublicKey: '...' }));
 * ```
 */
export function createServiceTokenMiddleware(config: ServiceTokenConfig) {
  const {
    jwtPublicKey,
    expectedIssuer,
    expectedAudience,
    skipPaths = ['/health'],
    clockToleranceSeconds = 30,
  } = config;

  return async (c: Context, next: Next): Promise<Response | void> => {
    // Skip authentication for certain paths (e.g., health checks)
    const path = new URL(c.req.url).pathname;
    if (skipPaths.includes(path)) {
      await next();
      return;
    }

    if (!jwtPublicKey) {
      const error = new ServiceUnavailableError('Service token not configured');
      return c.json(error.toResponse(), error.statusCode as 503);
    }

    if (!expectedIssuer || !expectedAudience) {
      const error = new ServiceUnavailableError('JWT verification requires expectedIssuer and expectedAudience');
      return c.json(error.toResponse(), error.statusCode as 503);
    }

    // Extract token from request
    const token = getServiceTokenFromHeader(c);
    if (!token) {
      const error = new AuthenticationError('Authorization token is required');
      return c.json(error.toResponse(), error.statusCode as 401);
    }

    if (!isJwtFormat(token)) {
      const error = new AuthenticationError('Service token must be a JWT');
      return c.json(error.toResponse(), error.statusCode as 401);
    }

    const result = verifyServiceToken({
      token,
      publicKey: jwtPublicKey,
      expectedAudience,
      expectedIssuer,
      clockToleranceSeconds,
    });

    if (result.valid && result.payload) {
      c.set('serviceToken', result.payload);
      c.set('serviceAuthMethod', 'jwt' as const);
      await next();
      return;
    }

    const error = new AuthenticationError(result.error || 'Invalid JWT token');
    return c.json(error.toResponse(), error.statusCode as 401);
  };
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Error handler options
 */
export interface ErrorHandlerOptions {
  /** Include stack traces in responses (only for development) */
  includeStack?: boolean;
  /** Custom error logger */
  logger?: (error: unknown, context?: Record<string, unknown>) => void;
  /** Custom error transformer */
  transformError?: (error: unknown) => AppError;
}

/**
 * Create Hono error handler (for use with `app.onError`)
 *
 * Usage:
 * ```typescript
 * import { createErrorHandler } from '@takos/common/middleware/hono';
 *
 * const app = new Hono();
 * app.onError(createErrorHandler({ includeStack: true }));
 * ```
 */
export function createErrorHandler(
  options: ErrorHandlerOptions = {}
): ErrorHandler {
  const { includeStack = false, logger = logError, transformError } = options;

  return (err: Error, c: Context) => {
    // Transform error if transformer provided
    let appError: AppError;
    if (transformError) {
      appError = transformError(err);
    } else if (isAppError(err)) {
      appError = err;
    } else {
      // Log non-operational errors with full details
      const path = new URL(c.req.url).pathname;
      logger(err, {
        path,
        method: c.req.method,
        requestId: c.req.header('x-request-id'),
      });
      appError = new InternalError('An unexpected error occurred');
    }

    // Build response
    const response = appError.toResponse();

    // Add stack trace in development mode
    if (includeStack && appError.stack) {
      (response.error as Record<string, unknown>).stack = appError.stack;
    }

    // Set special headers for rate limiting
    if (appError instanceof RateLimitError && appError.retryAfter) {
      c.header('Retry-After', String(appError.retryAfter));
    }

    return c.json(response, appError.statusCode as 500);
  };
}

/**
 * Not found handler for Hono
 * Use with `app.notFound()`
 *
 * Usage:
 * ```typescript
 * import { notFoundHandler } from '@takos/common/middleware/hono';
 *
 * const app = new Hono();
 * app.notFound(notFoundHandler);
 * ```
 */
export function notFoundHandler(c: Context) {
  const error = new NotFoundError('Route');
  return c.json(error.toResponse(), 404);
}

// ============================================================================
// Helper functions for route handlers
// ============================================================================

function buildErrorBody(
  message: string,
  code: ErrorCode,
  details?: unknown
): ErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  };
}

/**
 * 400 Bad Request
 */
export function badRequest(
  c: Context,
  message: string,
  details?: unknown
) {
  return c.json(buildErrorBody(message, ErrorCodes.BAD_REQUEST, details), 400);
}

/**
 * 404 Not Found
 */
export function notFound(
  c: Context,
  message = 'Not found',
  details?: unknown
) {
  return c.json(buildErrorBody(message, ErrorCodes.NOT_FOUND, details), 404);
}

/**
 * 403 Forbidden
 */
export function forbidden(c: Context, message = 'Access denied', details?: unknown) {
  return c.json(buildErrorBody(message, ErrorCodes.FORBIDDEN, details), 403);
}

/**
 * 500 Internal Server Error
 */
export function internalError(
  c: Context,
  message = 'Internal server error',
  details?: unknown
) {
  return c.json(buildErrorBody(message, ErrorCodes.INTERNAL_ERROR, details), 500);
}
