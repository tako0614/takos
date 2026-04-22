/**
 * Shared pagination utilities.
 *
 * Replaces the duplicated parseLimit/parseOffset + count + has_more pattern
 * that appears across 27+ route handlers.
 */

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

/**
 * Parse `limit` and `offset` from query-string values.
 *
 * @param query  - object whose `limit` / `offset` values are raw strings
 * @param defaults.limit    - fallback when the value is missing or invalid (default 20)
 * @param defaults.maxLimit - ceiling that the parsed limit is clamped to   (default 100)
 */
export function parsePagination(
  query: Record<string, string | undefined>,
  defaults?: { limit?: number; maxLimit?: number },
): PaginationParams {
  const fallbackLimit = defaults?.limit ?? 20;
  const maxLimit = defaults?.maxLimit ?? 100;

  const parsedLimit = Number.parseInt(query.limit ?? "", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, maxLimit)
    : fallbackLimit;

  const parsedOffset = Number.parseInt(query.offset ?? "", 10);
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0
    ? parsedOffset
    : 0;

  return { limit, offset };
}

/**
 * Build a standard paginated response envelope.
 *
 * `has_more` is `true` when there are rows beyond the current page:
 *   offset + items.length < total
 */
export function paginatedResponse<T>(
  items: T[],
  total: number,
  params: PaginationParams,
): PaginatedResult<T> {
  return {
    items,
    total,
    has_more: params.offset + items.length < total,
    limit: params.limit,
    offset: params.offset,
  };
}
