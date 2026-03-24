/**
 * Standardized Error Handling for Takos Platform
 *
 * This module provides a consistent error handling pattern across all takos packages.
 * All errors extend from AppError and include:
 * - code: A unique error code for client-side handling
 * - message: A user-safe message (no internal details)
 * - statusCode: The HTTP status code to return
 * - details: Optional field-level or additional details
 */

import type { Logger } from './logger.js';

/**
 * Standard error codes for consistent client handling
 */
export const ErrorCodes = {
  // 4xx Client Errors
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

  // 5xx Server Errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  BAD_GATEWAY: 'BAD_GATEWAY',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',

} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Standard error response format for API responses
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Field-level validation error details
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Base application error class
 * All custom errors should extend from this class
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;
  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.INTERNAL_ERROR,
    statusCode = 500,
    details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Convert error to API response format
   * This ensures no internal details leak to clients
   */
  toResponse(): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }

}

/**
 * 400 Bad Request - Invalid request syntax or parameters
 */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(message, ErrorCodes.BAD_REQUEST, 400, details);
  }
}

/**
 * 401 Unauthorized - Authentication required or invalid
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(message, ErrorCodes.UNAUTHORIZED, 401, details);
  }
}

/**
 * 403 Forbidden - Authenticated but not authorized
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Access denied', details?: unknown) {
    super(message, ErrorCodes.FORBIDDEN, 403, details);
  }
}

/**
 * 404 Not Found - Resource does not exist
 */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource', details?: unknown) {
    super(`${resource} not found`, ErrorCodes.NOT_FOUND, 404, details);
  }
}

/**
 * 409 Conflict - Resource conflict (e.g., duplicate)
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details?: unknown) {
    super(message, ErrorCodes.CONFLICT, 409, details);
  }
}

/**
 * 422 Unprocessable Entity - Validation failed
 */
export class ValidationError extends AppError {
  public readonly fieldErrors: ValidationErrorDetail[];

  constructor(
    message = 'Validation failed',
    fieldErrors: ValidationErrorDetail[] = []
  ) {
    super(
      message,
      ErrorCodes.VALIDATION_ERROR,
      422,
      fieldErrors.length > 0 ? { fields: fieldErrors } : undefined
    );
    this.fieldErrors = fieldErrors;
  }

}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(message = 'Rate limit exceeded', retryAfter?: number) {
    super(message, ErrorCodes.RATE_LIMITED, 429);
    this.retryAfter = retryAfter;
  }
}

/**
 * 500 Internal Server Error - Unexpected server error
 */
export class InternalError extends AppError {
  constructor(message = 'Internal server error', details?: unknown) {
    super(message, ErrorCodes.INTERNAL_ERROR, 500, details);
  }
}

/**
 * 503 Service Unavailable - Service temporarily unavailable
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details?: unknown) {
    super(message, ErrorCodes.SERVICE_UNAVAILABLE, 503, details);
  }
}

/**
 * 504 Gateway Timeout - Upstream service timeout
 */
export class GatewayTimeoutError extends AppError {
  constructor(message = 'Gateway timeout', details?: unknown) {
    super(message, ErrorCodes.GATEWAY_TIMEOUT, 504, details);
  }
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Convert unknown error to AppError
 * Use this to normalize errors before sending responses
 */
export function normalizeError(error: unknown, logger?: Logger): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    if (logger) {
      logger.error('Converting Error to AppError', { error });
    } else {
      console.error('[normalizeError] Converting Error to AppError:', error);
    }
    return new InternalError('An unexpected error occurred');
  }

  if (logger) {
    logger.error('Converting unknown to AppError', { value: String(error) });
  } else {
    console.error('[normalizeError] Converting unknown to AppError:', error);
  }
  return new InternalError('An unexpected error occurred');
}


/**
 * Log error with full details for server-side debugging
 */
export function logError(error: unknown, context?: Record<string, unknown>, logger?: Logger): void {
  const errorInfo = isAppError(error)
    ? {
        name: error.name,
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        details: error.details,
        stack: error.stack,
      }
    : {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };

  if (logger) {
    logger.error('Error', { ...errorInfo, ...context });
  } else {
    console.error('[Error]', {
      ...errorInfo,
      context,
      timestamp: new Date().toISOString(),
    });
  }
}

