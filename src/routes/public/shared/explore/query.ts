/**
 * Shared explore-query parsing helpers.
 *
 * `parsePagination` and `normalizeSimpleFilter` were previously copy-pasted into
 * `catalog.ts`, `discovery.ts`, and `packages.ts`, and had already drifted: the
 * catalog copy silently dropped invalid `language`/`license`/`category` filters
 * (returning `undefined`) while the discovery/packages copies rejected them with
 * a 400. This module is the single source of truth so the three explore surfaces
 * share one fail-closed contract:
 *
 * - `parsePagination` clamps `limit` to a per-caller maximum AND clamps `offset`
 *   to {@link MAX_EXPLORE_OFFSET} so a caller cannot force a deep SQL `OFFSET`
 *   scan (deep-offset resource amplification) on the anonymous explore read
 *   paths.
 * - `normalizeSimpleFilter` rejects an over-length or malformed filter by
 *   throwing the caller-supplied input error (fail-closed), rather than silently
 *   ignoring it.
 */

import { MAX_LIST_OFFSET } from "../api/common.ts";

export type PaginationDefaults = {
  /** Default limit when `limit` is missing or invalid. */
  limit: number;
  /** Maximum accepted `limit`. */
  maxLimit: number;
};

export type Pagination = {
  limit: number;
  offset: number;
};

export function parsePagination(
  query: URLSearchParams,
  defaults: PaginationDefaults,
): Pagination {
  const parsedLimit = Number.parseInt(query.get("limit") ?? "", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, defaults.maxLimit)
    : defaults.limit;

  const parsedOffset = Number.parseInt(query.get("offset") ?? "", 10);
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0
    ? Math.min(parsedOffset, MAX_LIST_OFFSET)
    : 0;

  return { limit, offset };
}

export type SimpleFilterOptions = {
  maxLen: number;
  pattern: RegExp;
};

/**
 * Normalizes a single-value filter (lowercased, trimmed) and validates it
 * against `pattern` / `maxLen`. Returns `undefined` for an absent/empty value
 * and throws `makeError("Invalid filter")` (fail-closed) for an invalid one.
 */
export function normalizeSimpleFilter(
  value: string | null,
  options: SimpleFilterOptions,
  makeError: (message: string) => Error,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (
    normalized.length > options.maxLen || !options.pattern.test(normalized)
  ) {
    throw makeError("Invalid filter");
  }
  return normalized;
}
