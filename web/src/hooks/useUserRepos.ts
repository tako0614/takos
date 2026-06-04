import type { Accessor } from "solid-js";
import type { ProfileRepo } from "../types/profile.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { useI18n } from "../store/i18n.ts";
import { createPaginatedListResource } from "./createPaginatedListResource.ts";

interface ReposResponse {
  repos: ProfileRepo[];
  has_more: boolean;
}

export function useUserRepos(username: Accessor<string>) {
  const { t } = useI18n();
  const resource = createPaginatedListResource<ProfileRepo>({
    source: username,
    initialError: t("failedToLoadRepositories"),
    fetchPage: async ({ source, offset, limit }) => {
      const res = await rpc.users[":username"].repos.$get({
        param: { username: source },
        query: { limit: String(limit), offset: String(offset) },
      });
      const data = await rpcJson<ReposResponse>(res);
      return { items: data.repos, hasMore: data.has_more };
    },
  });

  return {
    repos: resource.items,
    loading: resource.loading,
    hasMore: resource.hasMore,
    error: resource.error,
    fetch: resource.fetch,
    reset: resource.reset,
    updateRepo: resource.updateItems,
  };
}
