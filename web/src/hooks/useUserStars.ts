import type { Accessor } from "solid-js";
import type { StarredRepo } from "../types/profile.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { useI18n } from "../store/i18n.ts";
import { createPaginatedListResource } from "./createPaginatedListResource.ts";

interface StarsResponse {
  repos: StarredRepo[];
  has_more: boolean;
}

export function useUserStars(username: Accessor<string>) {
  const { t } = useI18n();
  const resource = createPaginatedListResource<StarredRepo>({
    source: username,
    initialError: t("failedToLoadStarredRepos"),
    fetchPage: async ({ source, offset, limit }) => {
      const res = await rpc.users[":username"].stars.$get({
        param: { username: source },
        query: { limit: String(limit), offset: String(offset) },
      });
      const data = await rpcJson<StarsResponse>(res);
      return { items: data.repos, hasMore: data.has_more };
    },
  });

  return {
    starredRepos: resource.items,
    loading: resource.loading,
    hasMore: resource.hasMore,
    error: resource.error,
    fetch: resource.fetch,
    reset: resource.reset,
    updateRepo: resource.updateItems,
  };
}
