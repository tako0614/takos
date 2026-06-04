import { type Accessor, createEffect, createSignal, on } from "solid-js";
import type { FollowUser } from "../types/profile.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { useI18n } from "../store/i18n.ts";
import { createPaginatedListResource } from "./createPaginatedListResource.ts";

interface FollowingResponse {
  following: FollowUser[];
  has_more: boolean;
}

export function useUserFollowing(username: Accessor<string>) {
  const { t } = useI18n();
  const [sort, setSort] = createSignal<"created" | "username">("created");
  const [order, setOrder] = createSignal<"desc" | "asc">("desc");

  const resource = createPaginatedListResource<FollowUser>({
    source: username,
    initialError: t("failedToLoadFollowing"),
    fetchPage: async ({ source, offset, limit }) => {
      const res = await rpc.users[":username"].following.$get({
        param: { username: source },
        query: {
          limit: String(limit),
          offset: String(offset),
          sort: sort(),
          order: order(),
        },
      });
      const data = await rpcJson<FollowingResponse>(res);
      return { items: data.following, hasMore: data.has_more };
    },
  });

  // Reset when sort/order changes
  createEffect(on(
    () => [sort(), order()],
    () => {
      resource.resetPage();
    },
  ));

  const setSortKey = (newSort: "created" | "username") => {
    setSort(newSort);
    setOrder(newSort === "username" ? "asc" : "desc");
  };

  return {
    following: resource.items,
    loading: resource.loading,
    hasMore: resource.hasMore,
    error: resource.error,
    sort,
    order,
    setSortKey,
    fetch: resource.fetch,
    reset: resource.reset,
    updateUser: resource.updateItems,
  };
}
