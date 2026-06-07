import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { createLatestRequest } from "../lib/createLatestRequest.ts";

const DEFAULT_ITEMS_PER_PAGE = 20;

export interface PaginatedPage<T> {
  items: T[];
  hasMore: boolean;
}

interface BasePaginatedListResourceOptions {
  /** Source accessor whose change resets the resource (typically `username`). */
  source: Accessor<string>;
  /** Fallback error message when the rejection is not an `Error`. */
  initialError: string;
  /** Page size. Defaults to 20. */
  perPage?: number;
}

/**
 * Offset-paginated variant (the default). `fetchPage` receives a numeric
 * `offset` that advances by `perPage` each load, suiting endpoints that take
 * `offset`/`limit` over a single ordered table.
 */
export interface OffsetPaginatedListResourceOptions<T>
  extends BasePaginatedListResourceOptions {
  mode?: "offset";
  /**
   * Fetch one page for the given source value and offset. Returns the page
   * items plus whether more pages exist. Errors are caught by the resource and
   * surfaced via `error` using `initialError`.
   */
  fetchPage: (args: {
    source: string;
    offset: number;
    limit: number;
  }) => Promise<PaginatedPage<T>>;
}

/**
 * Cursor-paginated variant. `fetchPage` receives the last item of the current
 * list as an opaque `cursor` (`undefined` on the first/reset load), suiting
 * keyset endpoints that page by a `before`/`after` token derived from the tail
 * item (e.g. a merge-sorted activity feed across several tables where a single
 * numeric offset cannot span the union).
 */
export interface CursorPaginatedListResourceOptions<T>
  extends BasePaginatedListResourceOptions {
  mode: "cursor";
  fetchPage: (args: {
    source: string;
    cursor: T | undefined;
    limit: number;
  }) => Promise<PaginatedPage<T>>;
}

export type CreatePaginatedListResourceOptions<T> =
  | OffsetPaginatedListResourceOptions<T>
  | CursorPaginatedListResourceOptions<T>;

export interface PaginatedListResource<T> {
  items: Accessor<T[]>;
  loading: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  error: Accessor<string | null>;
  /** Fetch a page; pass `true` to reset to the first page. */
  fetch: (reset?: boolean) => Promise<void>;
  /** Clear items/offset/error and re-enable `hasMore`. */
  reset: () => void;
  /** Clear items/offset and re-enable `hasMore` without touching `error`. */
  resetPage: () => void;
  /** Map over the current items (e.g. to flip a follow/star flag). */
  updateItems: (updater: (item: T) => T) => void;
  /** Keep only the items the predicate accepts (e.g. drop an un-starred repo). */
  filterItems: (predicate: (item: T) => boolean) => void;
}

/**
 * createPaginatedListResource — the paginated list state that was hand-rolled
 * across useUserFollowers / useUserFollowing / useUserStars / useUserRepos
 * (offset mode) and useUserActivity (cursor mode). Owns the
 * items/offset/hasMore/loading/error signals, the fetch(reset) flow with a
 * latest-wins stale guard, and the source-reset effect. Each hook supplies only
 * its endpoint mapping via `fetchPage` and wraps the returned signals with its
 * own named API.
 *
 * Offset mode (`mode: "offset"`, the default) advances a numeric offset by
 * `perPage`. Cursor mode (`mode: "cursor"`) passes the current tail item to
 * `fetchPage` as an opaque cursor instead, for keyset/merge-sorted endpoints.
 */
export function createPaginatedListResource<T>(
  options: CreatePaginatedListResourceOptions<T>,
): PaginatedListResource<T> {
  const perPage = options.perPage ?? DEFAULT_ITEMS_PER_PAGE;
  const [items, setItems] = createSignal<T[]>([]);
  const [offset, setOffset] = createSignal(0);
  const [hasMore, setHasMore] = createSignal(true);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const latest = createLatestRequest();

  const fetch_ = async (reset = false) => {
    const currentSource = options.source();
    if (!currentSource) return;
    if (!reset && !hasMore()) return;

    setLoading(true);
    setError(null);
    try {
      const isCurrent = () => currentSource === options.source();
      const page = await latest.run(
        () => {
          if (options.mode === "cursor") {
            const current = items();
            const cursor = reset || current.length === 0
              ? undefined
              : current[current.length - 1];
            return options.fetchPage({
              source: currentSource,
              cursor,
              limit: perPage,
            });
          }
          return options.fetchPage({
            source: currentSource,
            offset: reset ? 0 : offset(),
            limit: perPage,
          });
        },
        { isCurrent },
      );
      if (page === undefined) return;
      if (reset) {
        setItems(page.items);
        setOffset(perPage);
      } else {
        setItems((prev) => [...prev, ...page.items]);
        setOffset((prev) => prev + perPage);
      }
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : options.initialError);
    } finally {
      setLoading(false);
    }
  };

  const resetPage = () => {
    setItems([]);
    setOffset(0);
    setHasMore(true);
  };

  const reset = () => {
    resetPage();
    setError(null);
  };

  // Reset when the source changes.
  createEffect(on(
    options.source,
    () => {
      reset();
    },
  ));

  const updateItems = (updater: (item: T) => T) => {
    setItems((prev) => prev.map(updater));
  };

  const filterItems = (predicate: (item: T) => boolean) => {
    setItems((prev) => prev.filter(predicate));
  };

  return {
    items,
    loading,
    hasMore,
    error,
    fetch: fetch_,
    reset,
    resetPage,
    updateItems,
    filterItems,
  };
}
