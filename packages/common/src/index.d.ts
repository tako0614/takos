/**
 * takos-common - Shared utilities for Takos services
 *
 * This package provides common utilities used across all takos packages:
 * - ID generation (generateId)
 * - Validation helpers (isLocalhost, isPrivateIP)
 * - Error handling (AppError, ValidationError, etc.)
 * - Structured logging (createLogger)
 * - Hono middleware
 */
export { generateId, } from './id.js';
export { isLocalhost, isPrivateIP, } from './validation.js';
export { createLogger, type Logger, type LogLevel } from './logger.js';
export { throwIfAborted } from './abort.js';
export { parseIntEnv, parseIntEnvRequired, parseIntValue, parseFloatEnv, parseFloatValue, } from './env-parse.js';
export { ErrorCodes, type ErrorCode, AppError, BadRequestError, AuthenticationError, PaymentRequiredError, AuthorizationError, NotFoundError, ConflictError, GoneError, PayloadTooLargeError, ValidationError, RateLimitError, InternalError, NotImplementedError, BadGatewayError, ServiceUnavailableError, GatewayTimeoutError, isAppError, normalizeError, logError, getErrorMessage, type ErrorResponse, type ValidationErrorDetail, } from './errors.js';
//# sourceMappingURL=index.d.ts.map