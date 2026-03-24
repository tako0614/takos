/**
 * Pagination Utilities.
 *
 * Centralized pagination parsing that replaces the repeated
 * parseLimit/parseOffset pattern across 10+ route files.
 */

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, DEFAULT_PAGE_OFFSET } from '../config/limits';

export interface PaginationOptions {
  /** Override the default page size (defaults to {@link DEFAULT_PAGE_LIMIT}). */
  defaultLimit?: number;
  /** Override the maximum allowed page size (defaults to {@link MAX_PAGE_LIMIT}). */
  maxLimit?: number;
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * Parse `limit` and `offset` from a query-parameter bag.
 *
 * Invalid or out-of-range values are silently clamped to their respective
 * defaults so that callers never receive an unusable result.
 */
export function parsePagination(
  query: { limit?: string; offset?: string } | Record<string, string | undefined>,
  options?: PaginationOptions,
): PaginationParams {
  const defaultLimit = options?.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  const maxLimit = options?.maxLimit ?? MAX_PAGE_LIMIT;

  let limit = defaultLimit;
  const rawLimit =
    typeof query === 'object' ? (query.limit ?? query['limit']) : undefined;
  if (rawLimit) {
    const parsed = parseInt(rawLimit, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, maxLimit);
    }
  }

  let offset = DEFAULT_PAGE_OFFSET;
  const rawOffset =
    typeof query === 'object' ? (query.offset ?? query['offset']) : undefined;
  if (rawOffset) {
    const parsed = parseInt(rawOffset, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      offset = parsed;
    }
  }

  return { limit, offset };
}
