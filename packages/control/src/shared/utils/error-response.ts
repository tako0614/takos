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
 * This is the legacy format used in takos-control
 * New APIs should use the nested format from @takos/common
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
 */
export function unauthorized(
  c: AnyAppContext,
  message = 'Authentication required'
) {
  return errorResponse(c, 401, message, ErrorCodes.UNAUTHORIZED);
}

/**
 * 403 Forbidden
 */
export function forbidden(
  c: AnyAppContext,
  message = 'Access denied'
) {
  return errorResponse(c, 403, message, ErrorCodes.FORBIDDEN);
}

/**
 * 404 Not Found
 */
export function notFound(
  c: AnyAppContext,
  resource = 'Resource'
) {
  return errorResponse(c, 404, `${resource} not found`, ErrorCodes.NOT_FOUND);
}

/**
 * 409 Conflict
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
 */
export function serviceUnavailable(
  c: AnyAppContext,
  message = 'Service temporarily unavailable'
) {
  return errorResponse(c, 503, message, ErrorCodes.SERVICE_UNAVAILABLE);
}

/**
 * 402 Payment Required
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
 */
export function gone(
  c: AnyAppContext,
  message = 'Resource is no longer available'
) {
  return errorResponse(c, 410, message, 'GONE');
}

/**
 * 413 Payload Too Large
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
 */
export function notImplemented(
  c: AnyAppContext,
  message = 'Not implemented'
) {
  return errorResponse(c, 501, message, 'NOT_IMPLEMENTED');
}

/**
 * 502 Bad Gateway
 */
export function badGateway(
  c: AnyAppContext,
  message = 'Bad gateway'
) {
  return errorResponse(c, 502, message, ErrorCodes.BAD_GATEWAY);
}

/**
 * 504 Gateway Timeout
 */
export function gatewayTimeout(
  c: AnyAppContext,
  message = 'Gateway timeout'
) {
  return errorResponse(c, 504, message, ErrorCodes.GATEWAY_TIMEOUT);
}

/**
 * Handle database constraint errors
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
