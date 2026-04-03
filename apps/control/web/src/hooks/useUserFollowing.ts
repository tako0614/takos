import { type Accessor, createEffect, createSignal, on } from "solid-js";
import type { FollowUser } from "../types/profile.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";

interface FollowingResponse {
  following: FollowUser[];
  has_more: boolean;
}

const ITEMS_PER_PAGE = 20;

export function useUserFollowing(username: Accessor<string>) {
  const [following, setFollowing] = createSignal<FollowUser[]>([]);
  const [offset, setOffset] = createSignal(0);
  const [hasMore, setHasMore] = createSignal(true);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [sort, setSort] = createSignal<"created" | "username">("created");
  const [order, setOrder] = createSignal<"desc" | "asc">("desc");

  const fetch_ = async (reset = false) => {
    const currentUsername = username();
    if (!currentUsername) return;
    if (!reset && !hasMore()) return;

    setLoading(true);
    setError(null);
    try {
      const currentOffset = reset ? 0 : offset();
      const res = await rpc.users[":username"].following.$get({
        param: { username: currentUsername },
        query: {
          limit: String(ITEMS_PER_PAGE),
          offset: String(currentOffset),
          sort: sort(),
          order: order(),
        },
      });
      const data = await rpcJson<FollowingResponse>(res);
      if (currentUsername !== username()) return;
      if (reset) {
        setFollowing(data.following);
        setOffset(ITEMS_PER_PAGE);
      } else {
        setFollowing((prev) => [...prev, ...data.following]);
        setOffset((prev) => prev + ITEMS_PER_PAGE);
      }
      setHasMore(data.has_more);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load following");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFollowing([]);
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

  // Reset when sort/order changes
  createEffect(on(
    () => [sort(), order()],
    () => {
      setFollowing([]);
      setOffset(0);
      setHasMore(true);
    },
  ));

  const setSortKey = (newSort: "created" | "username") => {
    setSort(newSort);
    setOrder(newSort === "username" ? "asc" : "desc");
  };

  const updateUser = (updater: (user: FollowUser) => FollowUser) => {
    setFollowing((prev) => prev.map(updater));
  };

  return {
    following,
    loading,
    hasMore,
    error,
    sort,
    order,
    setSortKey,
    fetch: fetch_,
    reset,
    updateUser,
  };
}
