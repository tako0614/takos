import { useCallback, useEffect, useState } from 'react';
import type { ActivityEvent } from '../types/profile';
import { rpc, rpcJson } from '../lib/rpc';

interface ActivityResponse {
  events: ActivityEvent[];
  has_more: boolean;
}

const ITEMS_PER_PAGE = 20;

export function useUserActivity(username: string) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(
    async (reset = false) => {
      if (!reset && !hasMore) return;

      setLoading(true);
      setError(null);
      try {
        const before = reset
          ? null
          : (events.length > 0 ? events[events.length - 1].created_at : null);
        const res = await rpc.users[':username'].activity.$get({
          param: { username },
          query: {
            limit: String(ITEMS_PER_PAGE),
            ...(before ? { before } : {}),
          },
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          setError(data.error || 'Failed to load activity');
          setHasMore(false);
          return;
        }

        const data = await rpcJson<ActivityResponse>(res);
        if (reset) {
          setEvents(data.events || []);
        } else {
          setEvents((prev) => [...prev, ...(data.events || [])]);
        }
        setHasMore(!!data.has_more);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load activity');
      } finally {
        setLoading(false);
      }
    },
    [events, hasMore, username]
  );

  const reset = useCallback(() => {
    setEvents([]);
    setHasMore(true);
    setError(null);
  }, []);

  // Reset when username changes
  useEffect(() => {
    reset();
  }, [username, reset]);

  return {
    events,
    loading,
    hasMore,
    error,
    fetch: fetch_,
    reset,
  };
}
