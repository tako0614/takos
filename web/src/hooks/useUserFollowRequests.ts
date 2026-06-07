import { type Accessor, createSignal } from "solid-js";
import type { FollowRequest } from "../types/profile.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { useI18n } from "../store/i18n.ts";
import { createPaginatedListResource } from "./createPaginatedListResource.ts";

interface FollowRequestsResponse {
  requests: FollowRequest[];
  has_more: boolean;
  total?: number;
}

interface FollowRequestAcceptResponse {
  success: boolean;
  followers_count?: number;
}

export function useUserFollowRequests(
  username: Accessor<string>,
  onFollowersCountUpdate?: (count: number) => void,
) {
  const { t } = useI18n();
  const [actionLoadingId, setActionLoadingId] = createSignal<string | null>(
    null,
  );
  // Action (accept/reject) errors are surfaced through the same `error`
  // accessor as the list path. The resource owns list errors; this local
  // signal carries action errors and is merged below.
  const [actionError, setActionError] = createSignal<string | null>(null);

  const resource = createPaginatedListResource<FollowRequest>({
    source: username,
    initialError: t("failedToLoadFollowRequests"),
    fetchPage: async ({ source, offset, limit }) => {
      const res = await rpc.users[":username"]["follow-requests"].$get({
        param: { username: source },
        query: { limit: String(limit), offset: String(offset) },
      });
      if (!res.ok) {
        // Private endpoint; caller may not be the profile owner.
        return { items: [], hasMore: false };
      }
      const data = await rpcJson<FollowRequestsResponse>(res);
      return { items: data.requests || [], hasMore: !!data.has_more };
    },
  });

  const accept = async (requestId: string) => {
    const currentUsername = username();
    if (!currentUsername || actionLoadingId()) return;
    setActionLoadingId(requestId);
    setActionError(null);
    try {
      const res = await rpc.users[":username"]["follow-requests"][":id"].accept
        .$post({
          param: { username: currentUsername, id: requestId },
        });
      if (res.ok) {
        const data = await rpcJson<FollowRequestAcceptResponse>(res);
        resource.filterItems((r) => r.id !== requestId);
        const followersCount = data.followers_count;
        if (typeof followersCount === "number" && onFollowersCountUpdate) {
          onFollowersCountUpdate(followersCount);
        }
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("failedToAcceptFollowRequest"),
      );
    } finally {
      setActionLoadingId(null);
    }
  };

  const reject = async (requestId: string) => {
    const currentUsername = username();
    if (!currentUsername || actionLoadingId()) return;
    setActionLoadingId(requestId);
    setActionError(null);
    try {
      const res = await rpc.users[":username"]["follow-requests"][":id"].reject
        .$post({
          param: { username: currentUsername, id: requestId },
        });
      if (res.ok) {
        await rpcJson(res);
        resource.filterItems((r) => r.id !== requestId);
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("failedToRejectFollowRequest"),
      );
    } finally {
      setActionLoadingId(null);
    }
  };

  const reset = () => {
    resource.reset();
    setActionLoadingId(null);
    setActionError(null);
  };

  return {
    requests: resource.items,
    loading: resource.loading,
    hasMore: resource.hasMore,
    error: () => actionError() ?? resource.error(),
    actionLoadingId,
    fetch: resource.fetch,
    accept,
    reject,
    reset,
  };
}
