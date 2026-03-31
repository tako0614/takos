import { createSignal, createEffect, on } from 'solid-js';
import type { ProfileRepo } from '../types/profile.ts';
import { rpc, rpcJson } from '../lib/rpc.ts';

interface ReposResponse {
  repos: ProfileRepo[];
  has_more: boolean;
}

const ITEMS_PER_PAGE = 20;

export function useUserRepos(username: string) {
  const [repos, setRepos] = createSignal<ProfileRepo[]>([]);
  const [offset, setOffset] = createSignal(0);
  const [hasMore, setHasMore] = createSignal(true);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const fetch_ = async (reset = false) => {
    if (!reset && !hasMore()) return;

    setLoading(true);
    setError(null);
    try {
      const currentOffset = reset ? 0 : offset();
      const res = await rpc.users[':username'].repos.$get({
        param: { username },
        query: { limit: String(ITEMS_PER_PAGE), offset: String(currentOffset) },
      });
      const data = await rpcJson<ReposResponse>(res);
      if (reset) {
        setRepos(data.repos);
        setOffset(ITEMS_PER_PAGE);
      } else {
        setRepos((prev) => [...prev, ...data.repos]);
        setOffset((prev) => prev + ITEMS_PER_PAGE);
      }
      setHasMore(data.has_more);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repositories');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setRepos([]);
    setOffset(0);
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

  const updateRepo = (updater: (repo: ProfileRepo) => ProfileRepo) => {
    setRepos((prev) => prev.map(updater));
  };

  return {
    repos,
    loading,
    hasMore,
    error,
    fetch: fetch_,
    reset,
    updateRepo,
  };
}
