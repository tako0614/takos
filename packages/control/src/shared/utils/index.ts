// --- Date/time utilities ---

export function now(): string {
  return new Date().toISOString();
}

export function toIsoString(value: string | Date): string;
export function toIsoString(value: string | Date | null | undefined): string | null;
export function toIsoString(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

export function toRequiredIsoString(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

// --- Common utilities ---

export {
  buildDurableObjectUrl,
  extractBearerToken,
} from './common';

// --- Workspace access ---

export {
  loadSpace,
  loadSpaceMembership,
  checkWorkspaceAccess,
  hasPermission,
  type WorkspaceAccess,
} from './workspace';

// --- Naming ---

export { slugifyName } from './slug';

// --- ID generation ---

export { generateId } from '@takos/common/id';

// --- Rate limiting ---

export {
  InMemoryRateLimiter,
  RateLimiters,
  type RateLimitConfig,
  type RateLimitInfo,
} from './rate-limiter';

// --- Logging ---

export {
  logDebug,
  logInfo,
  logWarn,
  logError,
  createLogger,
  safeJsonParse,
  safeJsonParseOrDefault,
  type LogLevel,
  type LogContext,
} from './logger';

// --- Hashing ---

export {
  computeSHA256,
  verifyBundleHash,
  constantTimeEqual,
} from './hash';

// --- Encoding ---

export function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Reserved names ---

export {
  RESERVED_SUBDOMAINS,
  isReservedSubdomain,
  hasReservedSubdomain,
  isDomainReserved,
} from './reserved-domains';

export {
  RESERVED_USERNAMES,
  isReservedUsername,
  validateUsername,
} from './reserved-usernames';

// --- Cryptography ---

export {
  encrypt,
  decrypt,
  encryptEnvVars,
  decryptEnvVars,
  maskEnvVars,
  type EncryptedData,
} from './crypto';

// --- Error handling ---

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
  logError as logAppError,
  type ValidationErrorDetail,
  errorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  validationError,
  rateLimited,
  internalError,
  serviceUnavailable,
  handleDbError,
  type ErrorResponse,
  oauth2Error,
  type OAuth2ErrorResponse,
} from './error-response';
