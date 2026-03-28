/**
 * Shared utilities barrel.
 *
 * Only symbols that are actually consumed via this barrel are re-exported.
 * For everything else, import the specific module directly
 * (e.g. `./logger`, `./hash`, `./reserved-domains`).
 */

// --- Date/time utilities ---

export {
  now,
  toIsoString,
  toRequiredIsoString,
} from './date-utils';

// --- Common utilities ---

export {
  buildDurableObjectUrl,
  extractBearerToken,
} from './url-utils';

// --- Space access ---

export {
  checkSpaceAccess,
} from '../../application/services/identity/space-access';

// --- Naming ---

export {
  slugifyName,
  sanitizeRepoName,
} from './naming-utils';

// --- ID generation ---

export { generateId } from '@takos/common/id';

// --- Rate limiting ---

export {
  InMemoryRateLimiter,
} from './rate-limiter';

// --- Logging ---

export {
  safeJsonParseOrDefault,
} from './logger';

// --- Encoding ---

export {
  bytesToHex,
  base64UrlEncode,
} from './encoding-utils';

// --- Cryptography ---

export {
  encrypt,
  decrypt,
} from './crypto';
