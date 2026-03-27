import { useCallback, useEffect, useState } from 'react';
import type { FollowRequest } from '../types/profile';
import { rpc, rpcJson } from '../lib/rpc';

interface FollowRequestsResponse {
  requests: FollowRequest[];
  has_more: boolean;
  total?: number;
}

interface FollowRequestAcceptResponse {
  success: boolean;
  followers_count?: number;
}

const ITEMS_PER_PAGE = 20;

export function useUserFollowRequests(
  username: string,
  onFollowersCountUpdate?: (count: number) => void
) {
  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const fetch_ = useCallback(
    async (reset = false) => {
      if (!reset && !hasMore) return;

      setLoading(true);
      setError(null);
      try {
        const currentOffset = reset ? 0 : offset;
        const res = await rpc.users[':username']['follow-requests'].$get({
          param: { username },
          query: { limit: String(ITEMS_PER_PAGE), offset: String(currentOffset) },
        });

        if (!res.ok) {
          // Private endpoint; caller may not be the profile owner.
          setHasMore(false);
          return;
        }

        const data = await rpcJson<FollowRequestsResponse>(res);
        if (reset) {
          setRequests(data.requests || []);
          setOffset(ITEMS_PER_PAGE);
        } else {
          setRequests((prev) => [...prev, ...(data.requests || [])]);
          setOffset((prev) => prev + ITEMS_PER_PAGE);
        }
        setHasMore(!!data.has_more);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load follow requests');
      } finally {
        setLoading(false);
      }
    },
    [hasMore, offset, username]
  );

  const accept = useCallback(
    async (requestId: string) => {
      if (actionLoadingId) return;
      setActionLoadingId(requestId);
      try {
        const res = await rpc.users[':username']['follow-requests'][':id'].accept.$post({
          param: { username, id: requestId },
        });
        if (res.ok) {
          const data = await rpcJson<FollowRequestAcceptResponse>(res);
          setRequests((prev) => prev.filter((r) => r.id !== requestId));
          const followersCount = data.followers_count;
          if (typeof followersCount === 'number' && onFollowersCountUpdate) {
            onFollowersCountUpdate(followersCount);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to accept follow request');
      } finally {
        setActionLoadingId(null);
      }
    },
    [actionLoadingId, onFollowersCountUpdate, username]
  );

  const reject = useCallback(
    async (requestId: string) => {
      if (actionLoadingId) return;
      setActionLoadingId(requestId);
      try {
        const res = await rpc.users[':username']['follow-requests'][':id'].reject.$post({
          param: { username, id: requestId },
        });
        if (res.ok) {
          await rpcJson(res);
          setRequests((prev) => prev.filter((r) => r.id !== requestId));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reject follow request');
      } finally {
        setActionLoadingId(null);
      }
    },
    [actionLoadingId, username]
  );

  const reset = useCallback(() => {
    setRequests([]);
    setOffset(0);
    setHasMore(true);
    setError(null);
    setActionLoadingId(null);
  }, []);

  // Reset when username changes
  useEffect(() => {
    reset();
  }, [username, reset]);

  return {
    requests,
    loading,
    hasMore,
    error,
    actionLoadingId,
    fetch: fetch_,
    accept,
    reject,
    reset,
  };
}
