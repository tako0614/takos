import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { createLatestRequest } from "../lib/createLatestRequest.ts";

const DEFAULT_ITEMS_PER_PAGE = 20;

export interface PaginatedPage<T> {
  items: T[];
  hasMore: boolean;
}

export interface CreatePaginatedListResourceOptions<T> {
  /** Source accessor whose change resets the resource (typically `username`). */
  source: Accessor<string>;
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
  /** Fallback error message when the rejection is not an `Error`. */
  initialError: string;
  /** Page size. Defaults to 20. */
  perPage?: number;
}

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
}

/**
 * createPaginatedListResource — the offset-paginated list state that was
 * hand-rolled across useUserFollowers / useUserFollowing / useUserStars /
 * useUserRepos. Owns the items/offset/hasMore/loading/error signals, the
 * fetch(reset) flow with a latest-wins stale guard, and the source-reset
 * effect. Each hook supplies only its endpoint mapping via `fetchPage` and
 * wraps the returned signals with its own named API.
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
      const currentOffset = reset ? 0 : offset();
      const page = await latest.run(
        () =>
          options.fetchPage({
            source: currentSource,
            offset: currentOffset,
            limit: perPage,
          }),
        { isCurrent: () => currentSource === options.source() },
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

  return {
    items,
    loading,
    hasMore,
    error,
    fetch: fetch_,
    reset,
    resetPage,
    updateItems,
  };
}
