/**
 * @takos/common - Shared utilities for Takos services
 *
 * This package provides common utilities used across all takos packages:
 * - ID generation (generateId)
 * - Validation helpers (isLocalhost, isPrivateIP)
 * - Error handling (AppError, ValidationError, etc.)
 * - Structured logging (createLogger)
 * - Hono middleware
 */

// =============================================================================
// ID Generation Utilities
// =============================================================================
export {
  generateId,
} from './id.js';

// =============================================================================
// Validation Utilities
// =============================================================================
export {
  isLocalhost,
  isPrivateIP,
} from './validation.js';

// =============================================================================
// Structured Logging
// =============================================================================
export { createLogger, type Logger, type LogLevel } from './logger.js';

// =============================================================================
// Error Handling
// =============================================================================
export {
  // Error codes
  ErrorCodes,
  type ErrorCode,
  // Base errors
  AppError,
  // HTTP errors
  BadRequestError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  InternalError,
  ServiceUnavailableError,
  GatewayTimeoutError,
  // Utility functions
  isAppError,
  normalizeError,
  logError,
  // Types
  type ErrorResponse,
  type ValidationErrorDetail,
} from './errors.js';
