/**
 * Tool error codes, classification, and the ToolError class.
 *
 * Extracted from executor.ts to keep error-handling concerns in a single place.
 */

export const ErrorCodes = {
  CONFIGURATION_ERROR: 'E_CONFIG',
  PERMISSION_DENIED: 'E_PERMISSION',
  UNAUTHORIZED: 'E_UNAUTHORIZED',
  NOT_FOUND: 'E_NOT_FOUND',
  INVALID_PATH: 'E_INVALID_PATH',
  VALIDATION_ERROR: 'E_VALIDATION',
  INVALID_INPUT: 'E_INVALID_INPUT',
  MISSING_REQUIRED: 'E_MISSING_REQUIRED',
  INVALID_ARGUMENT: 'E_INVALID_ARGUMENT',
  TIMEOUT: 'E_TIMEOUT',
  NETWORK_ERROR: 'E_NETWORK',
  SERVICE_UNAVAILABLE: 'E_SERVICE_UNAVAILABLE',
  RATE_LIMITED: 'E_RATE_LIMITED',
  INTERNAL_ERROR: 'E_INTERNAL',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export type ErrorSeverity = 'fatal' | 'retriable' | 'user_error';

const ERROR_SEVERITY_MAP: Record<ErrorCode, ErrorSeverity> = {
  [ErrorCodes.CONFIGURATION_ERROR]: 'fatal',
  [ErrorCodes.PERMISSION_DENIED]: 'fatal',
  [ErrorCodes.UNAUTHORIZED]: 'fatal',
  [ErrorCodes.NOT_FOUND]: 'fatal',
  [ErrorCodes.INVALID_PATH]: 'fatal',
  [ErrorCodes.VALIDATION_ERROR]: 'fatal',
  [ErrorCodes.INVALID_INPUT]: 'user_error',
  [ErrorCodes.MISSING_REQUIRED]: 'user_error',
  [ErrorCodes.INVALID_ARGUMENT]: 'user_error',
  [ErrorCodes.TIMEOUT]: 'retriable',
  [ErrorCodes.NETWORK_ERROR]: 'retriable',
  [ErrorCodes.SERVICE_UNAVAILABLE]: 'retriable',
  [ErrorCodes.RATE_LIMITED]: 'retriable',
  [ErrorCodes.INTERNAL_ERROR]: 'retriable',
};

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ToolError';
  }

  get severity(): ErrorSeverity {
    return ERROR_SEVERITY_MAP[this.code] || 'retriable';
  }
}

export function classifyError(error: Error): { severity: ErrorSeverity; code?: ErrorCode } {
  if (error instanceof ToolError) {
    return { severity: error.severity, code: error.code };
  }

  const codeMatch = error.message.match(/\[(E_[A-Z_]+)\]/);
  if (codeMatch) {
    const code = codeMatch[1] as ErrorCode;
    if (code in ERROR_SEVERITY_MAP) {
      return { severity: ERROR_SEVERITY_MAP[code], code };
    }
  }

  // Fallback: pattern matching on error message for legacy support
  const lowerError = error.message.toLowerCase();

  const fatalPatterns = [
    'not configured',
    'permission denied',
    'unauthorized',
    'not found',
    'invalid path',
    'does not exist',
    'access denied',
  ];

  for (const pattern of fatalPatterns) {
    if (lowerError.includes(pattern)) {
      return { severity: 'fatal' };
    }
  }

  const userErrorPatterns = [
    'invalid',
    'required',
    'missing',
    'malformed',
    'expected',
    'must be',
    'cannot be empty',
  ];

  for (const pattern of userErrorPatterns) {
    if (lowerError.includes(pattern)) {
      return { severity: 'user_error' };
    }
  }

  return { severity: 'retriable' };
}

/** Human-readable hints appended to error messages based on severity. */
export const SEVERITY_HINTS: Record<string, string> = {
  fatal: ' (This error cannot be resolved by retrying)',
  user_error: ' (Please check your input parameters)',
};
