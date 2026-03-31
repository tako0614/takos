/**
 * Shared utilities barrel.
 *
 * Only symbols that are actually consumed via this barrel are re-exported.
 * For everything else, import the specific module directly
 * (e.g. `./logger`, `./hash`, `./domain-validation`).
 */

// --- Naming ---

export {
  slugifyName,
  sanitizeRepoName,
} from './naming-utils.ts';

// --- ID generation ---

export { generateId } from 'takos-common/id';

// --- Rate limiting ---

export {
  InMemoryRateLimiter,
} from './rate-limiter.ts';

// --- Logging ---

export {
  safeJsonParseOrDefault,
} from './logger.ts';

// --- Encoding ---

export {
  bytesToHex,
  base64UrlEncode,
} from './encoding-utils.ts';

// --- Cryptography ---

export {
  encrypt,
  decrypt,
} from './crypto.ts';

// --- Pagination ---

export {
  parsePagination,
  paginatedResponse,
  type PaginationParams,
  type PaginatedResult,
} from './pagination.ts';
