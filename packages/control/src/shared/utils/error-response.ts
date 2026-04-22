/**
 * @module error-response
 *
 * This module retains only the OAuth2 error helper (RFC 6749 format)
 * and re-exports from takos-common/errors.
 *
 * All legacy flat-format error helpers (badRequest, unauthorized, etc.)
 * have been removed. Use AppError subclasses from takos-common/errors
 * and throw them instead -- the global error handler produces the
 * standard nested response format.
 */

import type { Context } from "hono";

export {
  AppError,
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  ConflictError,
  type ErrorCode,
  ErrorCodes,
  InternalError,
  isAppError,
  logError,
  normalizeError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
  type ValidationErrorDetail,
} from "takos-common/errors";

export interface OAuth2ErrorResponse {
  error: string;
  error_description?: string;
  error_uri?: string;
}

export function oauth2Error(
  c: Context,
  status: number,
  error: string,
  description?: string,
): Response {
  const response: OAuth2ErrorResponse = { error };
  if (description) {
    response.error_description = description;
  }
  return c.json(response, status as 400);
}
