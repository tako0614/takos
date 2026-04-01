/**
 * Shared utilities barrel.
 *
 * Only symbols that are actually consumed via this barrel are re-exported.
 * For everything else, import the specific module directly
 * (e.g. `./logger`, `./hash`, `./domain-validation`).
 */

// --- Naming ---

export { sanitizeRepoName, slugifyName } from "./naming-utils.ts";

// --- ID generation ---

export { generateId } from "takos-common/id";

// --- Rate limiting ---

export { InMemoryRateLimiter } from "./rate-limiter.ts";

// --- Logging ---

export { safeJsonParseOrDefault } from "./logger.ts";

// --- Encoding ---

export {
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
} from "./encoding-utils.ts";

// --- Cryptography ---

export { decrypt, encrypt } from "./crypto.ts";

// --- Pagination ---

export {
  paginatedResponse,
  type PaginatedResult,
  type PaginationParams,
  parsePagination,
} from "./pagination.ts";
