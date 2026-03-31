import { createSignal, createEffect, on } from 'solid-js';
import type { ActivityEvent } from '../types/profile';
import { rpc, rpcJson } from '../lib/rpc';

interface ActivityResponse {
  events: ActivityEvent[];
  has_more: boolean;
}

const ITEMS_PER_PAGE = 20;

export function useUserActivity(username: string) {
  const [events, setEvents] = createSignal<ActivityEvent[]>([]);
  const [hasMore, setHasMore] = createSignal(true);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const fetch_ = async (reset = false) => {
    if (!reset && !hasMore()) return;

    setLoading(true);
    setError(null);
    try {
      const before = reset
        ? null
        : (events().length > 0 ? events()[events().length - 1].created_at : null);
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
  };

  const reset = () => {
    setEvents([]);
    setHasMore(true);
    setError(null);
  };

  // Reset when username changes
  createEffect(on(
    () => username,
    () => {
      reset();
    },
  ));

  return {
    events,
    loading,
    hasMore,
    error,
    fetch: fetch_,
    reset,
  };
}
