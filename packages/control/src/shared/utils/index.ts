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

// Durable Object URL builder (formerly services/durable-object-url.ts)
const DURABLE_OBJECT_INTERNAL_ORIGIN = 'https://internal.do';

export function buildDurableObjectUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${DURABLE_OBJECT_INTERNAL_ORIGIN}${normalizedPath}`;
}

/** Length of the 'Bearer ' prefix used when extracting tokens. */
const BEARER_PREFIX_LENGTH = 7;

export function extractBearerToken(header: string | undefined | null): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(BEARER_PREFIX_LENGTH).trim();
  return token || null;
}

// --- Space access ---

export {
  loadSpace,
  loadSpaceMembership,
  checkSpaceAccess,
  hasPermission,
  type SpaceAccess,
} from './space-access';

// --- Naming ---

/** Maximum length of a generated slug. */
const MAX_SLUG_LENGTH = 32;

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH) || 'space';
}

export function sanitizeRepoName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

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
// NOTE: Error classes and response helpers (BadRequestError, notFound, etc.)
// are intentionally NOT re-exported here. Import them directly from
// './error-response' to keep this barrel lean and aid tree-shaking.
