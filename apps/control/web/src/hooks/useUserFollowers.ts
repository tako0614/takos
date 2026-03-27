import { useCallback, useEffect, useState } from 'react';
import type { FollowUser } from '../types/profile';
import { rpc, rpcJson } from '../lib/rpc';

interface FollowersResponse {
  followers: FollowUser[];
  has_more: boolean;
}

const ITEMS_PER_PAGE = 20;

export function useUserFollowers(username: string) {
  const [followers, setFollowers] = useState<FollowUser[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<'created' | 'username'>('created');
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');

  const fetch_ = useCallback(
    async (reset = false) => {
      if (!reset && !hasMore) return;

      setLoading(true);
      setError(null);
      try {
        const currentOffset = reset ? 0 : offset;
        const res = await rpc.users[':username'].followers.$get({
          param: { username },
          query: {
            limit: String(ITEMS_PER_PAGE),
            offset: String(currentOffset),
            sort,
            order,
          },
        });
        const data = await rpcJson<FollowersResponse>(res);
        if (reset) {
          setFollowers(data.followers);
          setOffset(ITEMS_PER_PAGE);
        } else {
          setFollowers((prev) => [...prev, ...data.followers]);
          setOffset((prev) => prev + ITEMS_PER_PAGE);
        }
        setHasMore(data.has_more);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load followers');
      } finally {
        setLoading(false);
      }
    },
    [username, offset, hasMore, sort, order]
  );

  const reset = useCallback(() => {
    setFollowers([]);
    setOffset(0);
    setHasMore(true);
    setError(null);
  }, []);

  // Reset when username changes
  useEffect(() => {
    reset();
  }, [username, reset]);

  // Reset when sort/order changes
  useEffect(() => {
    setFollowers([]);
    setOffset(0);
    setHasMore(true);
  }, [sort, order]);

  const setSortKey = useCallback((newSort: 'created' | 'username') => {
    setSort(newSort);
    setOrder(newSort === 'username' ? 'asc' : 'desc');
  }, []);

  const updateUser = useCallback((updater: (user: FollowUser) => FollowUser) => {
    setFollowers((prev) => prev.map(updater));
  }, []);

  return {
    followers,
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
