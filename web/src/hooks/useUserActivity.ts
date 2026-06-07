import type { Accessor } from "solid-js";
import type { ActivityEvent } from "../types/profile.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { useI18n } from "../store/i18n.ts";
import { createPaginatedListResource } from "./createPaginatedListResource.ts";

interface ActivityResponse {
  events: ActivityEvent[];
  has_more: boolean;
}

export function useUserActivity(username: Accessor<string>) {
  const { t } = useI18n();
  // Cursor-paginated: the activity feed merge-sorts several backend tables, so
  // it pages by a `before` token taken from the tail event's created_at rather
  // than a numeric offset (which cannot span the union).
  const resource = createPaginatedListResource<ActivityEvent>({
    mode: "cursor",
    source: username,
    initialError: t("failedToLoadActivity"),
    fetchPage: async ({ source, cursor, limit }) => {
      const before = cursor?.created_at;
      const res = await rpc.users[":username"].activity.$get({
        param: { username: source },
        query: {
          limit: String(limit),
          ...(before ? { before } : {}),
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || t("failedToLoadActivity"));
      }
      const data = await rpcJson<ActivityResponse>(res);
      return { items: data.events || [], hasMore: !!data.has_more };
    },
  });

  return {
    events: resource.items,
    loading: resource.loading,
    hasMore: resource.hasMore,
    error: resource.error,
    fetch: resource.fetch,
    reset: resource.reset,
  };
}
