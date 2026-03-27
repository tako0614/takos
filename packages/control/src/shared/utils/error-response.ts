/**
 * @module error-response (LEGACY)
 *
 * ============================================================================
 * DEPRECATION NOTICE
 * ============================================================================
 *
 * The helper functions in this file produce the LEGACY flat error format:
 *
 *   { error: string, code?: string, details?: unknown }
 *
 * New code should use the STANDARD nested format from @takos/common/errors:
 *
 *   { error: { code: ErrorCode, message: string, details?: unknown } }
 *
 * MIGRATION GUIDE
 * ---------------
 * 1. For route handlers that return Hono responses, replace:
 *      import { badRequest } from '../../shared/utils/error-response';
 *      return badRequest(c, 'Invalid input');
 *    with:
 *      import { BadRequestError } from '@takos/common/errors';
 *      throw new BadRequestError('Invalid input');
 *    and let the global error handler produce the standard response.
 *
 * 2. For service-layer code that already throws AppError subclasses
 *    (BadRequestError, NotFoundError, etc.), no change is needed --
 *    those classes come from @takos/common/errors and are re-exported here.
 *
 * 3. The ErrorResponse interface (flat format) should NOT be used in new
 *    APIs. Use the nested ErrorResponse from @takos/common/errors instead.
 *
 * 4. The `handleDbError` helper can be replaced by throwing AppError
 *    subclasses directly (ConflictError, BadRequestError, ValidationError)
 *    in database access layers.
 *
 * 5. The `oauth2Error` helper follows RFC 6749 and is NOT deprecated.
 *
 * This migration should happen incrementally, file by file.
 * ============================================================================
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../types';
import { ErrorCodes } from '@takos/common/errors';
import { logError } from './logger';

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
} from '@takos/common/errors';

/**
 * Standard error response format for API responses
 * This is the legacy flat format used in takos-control.
 * New APIs should use the nested {@link import('@takos/common/errors').ErrorResponse} format from @takos/common/errors.
 * @deprecated Use `ErrorResponse` from `@takos/common/errors` instead, which uses the nested `{ error: { code, message, details? } }` format.
 */
export interface ErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Broad context type for error response helper functions.
 * These helpers only call c.json() and c.header(), so they don't need
 * the full typed context with Variables. Using Context<any> avoids
 * contravariance issues with Variables while keeping type safety for
 * the response body.
 * @deprecated Only used by the legacy error helper functions in this file.
 * When those callers are migrated to throw `AppError` subclasses, this type will be removed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAppContext = Context<any>;

/**
 * Create standardized error response
 * @param c - Hono context
 * @param status - HTTP status code
 * @param message - Human-readable error message
 * @param code - Machine-readable error code (string to allow extended error codes)
 * @param details - Optional additional details
 * @deprecated Use `AppError` subclasses from `@takos/common/errors` and throw them instead.
 * The global error handler will produce the standard nested response format.
 */
export function errorResponse(
  c: AnyAppContext,
  status: number,
  message: string,
  code?: string,
  details?: unknown
) {
  const body: ErrorResponse = { error: message };
  if (code) body.code = code;
  if (details !== undefined) body.details = details;
  return c.json(body, status as ContentfulStatusCode);
}

/**
 * 400 Bad Request
 * @deprecated Use `throw new BadRequestError(message, details)` from `@takos/common/errors` instead.
 */
export function badRequest(
  c: AnyAppContext,
  message: string,
  details?: unknown
) {
  return errorResponse(c, 400, message, ErrorCodes.BAD_REQUEST, details);
}

/**
 * 401 Unauthorized
 * @deprecated Use `throw new AuthenticationError(message)` from `@takos/common/errors` instead.
 */
export function unauthorized(
  c: AnyAppContext,
  message = 'Authentication required'
) {
  return errorResponse(c, 401, message, ErrorCodes.UNAUTHORIZED);
}

/**
 * 403 Forbidden
 * @deprecated Use `throw new AuthorizationError(message)` from `@takos/common/errors` instead.
 */
export function forbidden(
  c: AnyAppContext,
  message = 'Access denied'
) {
  return errorResponse(c, 403, message, ErrorCodes.FORBIDDEN);
}

/**
 * 404 Not Found
 * @deprecated Use `throw new NotFoundError(resource)` from `@takos/common/errors` instead.
 */
export function notFound(
  c: AnyAppContext,
  resource = 'Resource'
) {
  return errorResponse(c, 404, `${resource} not found`, ErrorCodes.NOT_FOUND);
}

/**
 * 409 Conflict
 * @deprecated Use `throw new ConflictError(message, details)` from `@takos/common/errors` instead.
 */
export function conflict(
  c: AnyAppContext,
  message: string,
  details?: unknown
) {
  return errorResponse(c, 409, message, ErrorCodes.CONFLICT, details);
}

/**
 * 422 Validation Error
 * @deprecated Use `throw new ValidationError(message, fieldErrors)` from `@takos/common/errors` instead.
 */
export function validationError(
  c: AnyAppContext,
  message: string,
  details?: unknown
) {
  return errorResponse(c, 422, message, ErrorCodes.VALIDATION_ERROR, details);
}

/**
 * 500 Internal Server Error
 * @deprecated Use `throw new InternalError(message, details)` from `@takos/common/errors` instead.
 */
export function internalError(
  c: AnyAppContext,
  message = 'Internal server error',
  details?: unknown
) {
  return errorResponse(c, 500, message, ErrorCodes.INTERNAL_ERROR, details);
}

/**
 * 503 Service Unavailable
 * @deprecated Use `throw new ServiceUnavailableError(message, details)` from `@takos/common/errors` instead.
 */
export function serviceUnavailable(
  c: AnyAppContext,
  message = 'Service temporarily unavailable'
) {
  return errorResponse(c, 503, message, ErrorCodes.SERVICE_UNAVAILABLE);
}

/**
 * 402 Payment Required
 * @deprecated Define a `PaymentRequiredError` extending `AppError` in `@takos/common/errors` and throw it instead.
 */
export function paymentRequired(
  c: AnyAppContext,
  message = 'Payment required',
  details?: unknown
) {
  return errorResponse(c, 402, message, 'PAYMENT_REQUIRED', details);
}

/**
 * 410 Gone
 * @deprecated Define a `GoneError` extending `AppError` in `@takos/common/errors` and throw it instead.
 */
export function gone(
  c: AnyAppContext,
  message = 'Resource is no longer available'
) {
  return errorResponse(c, 410, message, 'GONE');
}

/**
 * 413 Payload Too Large
 * @deprecated Define a `PayloadTooLargeError` extending `AppError` in `@takos/common/errors` and throw it instead.
 */
export function payloadTooLarge(
  c: AnyAppContext,
  message = 'Payload too large',
  details?: unknown
) {
  return errorResponse(c, 413, message, ErrorCodes.PAYLOAD_TOO_LARGE, details);
}

/**
 * 429 Rate Limited
 * @deprecated Use `throw new RateLimitError(message, retryAfter)` from `@takos/common/errors` instead.
 */
export function rateLimited(
  c: AnyAppContext,
  retryAfter?: number
) {
  const response = errorResponse(c, 429, 'Rate limit exceeded', ErrorCodes.RATE_LIMITED);
  if (retryAfter) {
    c.header('Retry-After', String(retryAfter));
  }
  return response;
}

/**
 * 501 Not Implemented
 * @deprecated Define a `NotImplementedError` extending `AppError` in `@takos/common/errors` and throw it instead.
 */
export function notImplemented(
  c: AnyAppContext,
  message = 'Not implemented'
) {
  return errorResponse(c, 501, message, 'NOT_IMPLEMENTED');
}

/**
 * 502 Bad Gateway
 * @deprecated Define a `BadGatewayError` extending `AppError` in `@takos/common/errors` and throw it instead.
 */
export function badGateway(
  c: AnyAppContext,
  message = 'Bad gateway'
) {
  return errorResponse(c, 502, message, ErrorCodes.BAD_GATEWAY);
}

/**
 * 504 Gateway Timeout
 * @deprecated Define a `GatewayTimeoutError` extending `AppError` in `@takos/common/errors` and throw it instead.
 */
export function gatewayTimeout(
  c: AnyAppContext,
  message = 'Gateway timeout'
) {
  return errorResponse(c, 504, message, ErrorCodes.GATEWAY_TIMEOUT);
}

/**
 * Handle database constraint errors
 * @deprecated Throw `ConflictError`, `BadRequestError`, or `ValidationError` from `@takos/common/errors`
 * directly in database access layers instead of catching and converting at the route level.
 */
export function handleDbError(
  c: AnyAppContext,
  err: unknown,
  entityName = 'Record'
) {
  const errStr = String(err);

  if (errStr.includes('UNIQUE constraint')) {
    return conflict(c, `${entityName} already exists`);
  }
  if (errStr.includes('FOREIGN KEY constraint')) {
    return badRequest(c, `Referenced ${entityName.toLowerCase()} does not exist`);
  }
  if (errStr.includes('NOT NULL constraint')) {
    return validationError(c, 'Required field is missing');
  }

  logError(`Database error for ${entityName}`, err, { module: 'utils/error-response' });
  return internalError(c, 'Database operation failed');
}

export interface OAuth2ErrorResponse {
  error: string;
  error_description?: string;
  error_uri?: string;
}

export function oauth2Error(
  c: Context,
  status: number,
  error: string,
  description?: string
): Response {
  const response: OAuth2ErrorResponse = { error };
  if (description) {
    response.error_description = description;
  }
  return c.json(response, status as 400);
}
