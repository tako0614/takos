import { type Accessor, createEffect, createSignal, on } from "solid-js";
import type { StarredRepo } from "../types/profile.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";

interface StarsResponse {
  repos: StarredRepo[];
  has_more: boolean;
}

const ITEMS_PER_PAGE = 20;

export function useUserStars(username: Accessor<string>) {
  const [starredRepos, setStarredRepos] = createSignal<StarredRepo[]>([]);
  const [offset, setOffset] = createSignal(0);
  const [hasMore, setHasMore] = createSignal(true);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const fetch_ = async (reset = false) => {
    const currentUsername = username();
    if (!currentUsername) return;
    if (!reset && !hasMore()) return;

    setLoading(true);
    setError(null);
    try {
      const currentOffset = reset ? 0 : offset();
      const res = await rpc.users[":username"].stars.$get({
        param: { username: currentUsername },
        query: { limit: String(ITEMS_PER_PAGE), offset: String(currentOffset) },
      });
      const data = await rpcJson<StarsResponse>(res);
      if (currentUsername !== username()) return;
      if (reset) {
        setStarredRepos(data.repos);
        setOffset(ITEMS_PER_PAGE);
      } else {
        setStarredRepos((prev) => [...prev, ...data.repos]);
        setOffset((prev) => prev + ITEMS_PER_PAGE);
      }
      setHasMore(data.has_more);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load starred repos",
      );
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStarredRepos([]);
    setOffset(0);
    setHasMore(true);
    setError(null);
  };

  // Reset when username changes
  createEffect(on(
    username,
    () => {
      reset();
    },
  ));

  const updateRepo = (updater: (repo: StarredRepo) => StarredRepo) => {
    setStarredRepos((prev) => prev.map(updater));
  };

  return {
    starredRepos,
    loading,
    hasMore,
    error,
    fetch: fetch_,
    reset,
    updateRepo,
  };
}
