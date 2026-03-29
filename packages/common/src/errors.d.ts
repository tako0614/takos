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
export declare const ErrorCodes: {
    readonly BAD_REQUEST: "BAD_REQUEST";
    readonly UNAUTHORIZED: "UNAUTHORIZED";
    readonly PAYMENT_REQUIRED: "PAYMENT_REQUIRED";
    readonly FORBIDDEN: "FORBIDDEN";
    readonly NOT_FOUND: "NOT_FOUND";
    readonly CONFLICT: "CONFLICT";
    readonly GONE: "GONE";
    readonly VALIDATION_ERROR: "VALIDATION_ERROR";
    readonly RATE_LIMITED: "RATE_LIMITED";
    readonly PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE";
    readonly INTERNAL_ERROR: "INTERNAL_ERROR";
    readonly NOT_IMPLEMENTED: "NOT_IMPLEMENTED";
    readonly SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE";
    readonly BAD_GATEWAY: "BAD_GATEWAY";
    readonly GATEWAY_TIMEOUT: "GATEWAY_TIMEOUT";
};
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
export declare class AppError extends Error {
    readonly code: ErrorCode;
    readonly statusCode: number;
    readonly details?: unknown;
    constructor(message: string, code?: ErrorCode, statusCode?: number, details?: unknown);
    /**
     * Convert error to API response format
     * This ensures no internal details leak to clients
     */
    toResponse(): ErrorResponse;
}
/**
 * 400 Bad Request - Invalid request syntax or parameters
 */
export declare class BadRequestError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * 401 Unauthorized - Authentication required or invalid
 */
export declare class AuthenticationError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * 402 Payment Required - Payment is required to access the resource
 */
export declare class PaymentRequiredError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * 403 Forbidden - Authenticated but not authorized
 */
export declare class AuthorizationError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * 404 Not Found - Resource does not exist
 */
export declare class NotFoundError extends AppError {
    constructor(resource?: string, details?: unknown);
}
/**
 * 409 Conflict - Resource conflict (e.g., duplicate)
 */
export declare class ConflictError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * 410 Gone - Resource no longer available
 */
export declare class GoneError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * 413 Payload Too Large - Request payload exceeds limit
 */
export declare class PayloadTooLargeError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * 422 Unprocessable Entity - Validation failed
 */
export declare class ValidationError extends AppError {
    readonly fieldErrors: ValidationErrorDetail[];
    constructor(message?: string, fieldErrors?: ValidationErrorDetail[]);
}
/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export declare class RateLimitError extends AppError {
    readonly retryAfter?: number;
    constructor(message?: string, retryAfter?: number);
}
/**
 * 500 Internal Server Error - Unexpected server error
 */
export declare class InternalError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * 501 Not Implemented - Functionality not implemented
 */
export declare class NotImplementedError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * 502 Bad Gateway - Invalid response from upstream service
 */
export declare class BadGatewayError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * 503 Service Unavailable - Service temporarily unavailable
 */
export declare class ServiceUnavailableError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * 504 Gateway Timeout - Upstream service timeout
 */
export declare class GatewayTimeoutError extends AppError {
    constructor(message?: string, details?: unknown);
}
/**
 * Type guard to check if an error is an AppError
 */
export declare function isAppError(error: unknown): error is AppError;
/**
 * Convert unknown error to AppError
 * Use this to normalize errors before sending responses
 */
export declare function normalizeError(error: unknown, logger?: Logger): AppError;
/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * When called with a single argument the behaviour matches the former
 * `runtime-service/utils/error-message` helper (`String(err)` for
 * non-Error values).  When a `fallback` string is supplied the
 * behaviour matches the former `control/web/lib/errors` helper
 * (returns the fallback when no meaningful message can be extracted).
 */
export declare function getErrorMessage(error: unknown, fallback?: string): string;
/**
 * Log error with full details for server-side debugging
 */
export declare function logError(error: unknown, context?: Record<string, unknown>, logger?: Logger): void;
//# sourceMappingURL=errors.d.ts.map