import { useEffect, useRef, useState } from 'react';
import type { ExploreSort, SearchOrder, SearchSort, SourceRepo, SourceTab } from '../types/repos';
import { rpc, rpcJson } from '../lib/rpc';

interface UseReposDataOptions {
  selectedWorkspaceId?: string;
  initialTab: SourceTab;
}

export function useReposData({ selectedWorkspaceId, initialTab }: UseReposDataOptions) {
  const [activeTab, setActiveTab] = useState<SourceTab>(initialTab);
  const PAGE_SIZE = 20;
  const myReposRequestSeqRef = useRef(0);
  const exploreRequestSeqRef = useRef(0);
  const starredRequestSeqRef = useRef(0);
  const searchRequestSeqRef = useRef(0);

  const [myRepos, setMyRepos] = useState<SourceRepo[]>([]);
  const [myReposLoading, setMyReposLoading] = useState(true);
  const [myReposError, setMyReposError] = useState<string | null>(null);

  const [exploreRepos, setExploreRepos] = useState<SourceRepo[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreSort, setExploreSort] = useState<ExploreSort>('trending');
  const [exploreOffset, setExploreOffset] = useState(0);
  const [exploreHasMore, setExploreHasMore] = useState(false);
  const [exploreTotal, setExploreTotal] = useState(0);

  const [starredRepos, setStarredRepos] = useState<SourceRepo[]>([]);
  const [starredLoading, setStarredLoading] = useState(false);
  const [starredOffset, setStarredOffset] = useState(0);
  const [starredHasMore, setStarredHasMore] = useState(false);
  const [starredTotal, setStarredTotal] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SourceRepo[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchSort, setSearchSort] = useState<SearchSort>('stars');
  const [searchOrder, setSearchOrder] = useState<SearchOrder>('desc');
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);

  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    if (selectedWorkspaceId && activeTab === 'repos') {
      void fetchMyRepos();
    }
  }, [selectedWorkspaceId, activeTab]);

  useEffect(() => {
    if (activeTab === 'explore') {
      void fetchExploreRepos(true);
    }
  }, [activeTab, exploreSort]);

  useEffect(() => {
    if (activeTab === 'starred') {
      void fetchStarredRepos(true);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      searchRequestSeqRef.current += 1;
      setSearchResults([]);
      setSearchTotal(0);
      setSearchHasMore(false);
      return;
    }
    const timer = setTimeout(() => {
      void searchRepos(searchQuery, true);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchSort, searchOrder]);

  const fetchMyRepos = async () => {
    if (!selectedWorkspaceId) return;
    const requestId = ++myReposRequestSeqRef.current;
    try {
      setMyReposLoading(true);
      setMyReposError(null);
      const res = await rpc.spaces[':spaceId'].repos.$get({
        param: { spaceId: selectedWorkspaceId },
      });
      const data = await rpcJson<{ repositories?: SourceRepo[] }>(res);
      if (requestId !== myReposRequestSeqRef.current) return;
      setMyRepos(data.repositories || []);
    } catch (err) {
      if (requestId !== myReposRequestSeqRef.current) return;
      setMyReposError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (requestId === myReposRequestSeqRef.current) {
        setMyReposLoading(false);
      }
    }
  };

  const fetchExploreRepos = async (reset = false, offsetOverride?: number) => {
    const requestId = ++exploreRequestSeqRef.current;
    try {
      setExploreLoading(true);
      const offset = typeof offsetOverride === 'number'
        ? offsetOverride
        : reset
          ? 0
          : exploreOffset;
      const res = await rpc.explore.repos.$get({
        query: { sort: exploreSort, limit: String(PAGE_SIZE), offset: String(offset) },
      });
      const data = await rpcJson<{ repos?: SourceRepo[]; has_more?: boolean; total?: number }>(res);
      if (requestId !== exploreRequestSeqRef.current) return;
      if (reset) {
        setExploreRepos(data.repos || []);
        setExploreOffset(0);
      } else {
        setExploreRepos((prev) => [...prev, ...(data.repos || [])]);
      }
      setExploreHasMore(!!data.has_more);
      setExploreTotal(data.total || 0);
    } catch (err) {
      if (requestId !== exploreRequestSeqRef.current) return;
      console.error('Failed to fetch explore repos:', err);
    } finally {
      if (requestId === exploreRequestSeqRef.current) {
        setExploreLoading(false);
      }
    }
  };

  const fetchStarredRepos = async (reset = false, offsetOverride?: number) => {
    const requestId = ++starredRequestSeqRef.current;
    try {
      setStarredLoading(true);
      const offset = typeof offsetOverride === 'number'
        ? offsetOverride
        : reset
          ? 0
          : starredOffset;
      const res = await rpc.repos.starred.$get({
        query: { limit: String(PAGE_SIZE), offset: String(offset) },
      });
      const data = await rpcJson<{ repos?: SourceRepo[]; has_more?: boolean; total?: number }>(res);
      if (requestId !== starredRequestSeqRef.current) return;
      if (reset) {
        setStarredRepos(data.repos || []);
        setStarredOffset(0);
      } else {
        setStarredRepos((prev) => [...prev, ...(data.repos || [])]);
      }
      setStarredHasMore(!!data.has_more);
      setStarredTotal(data.total || 0);
    } catch (err) {
      if (requestId !== starredRequestSeqRef.current) return;
      console.error('Failed to fetch starred repos:', err);
    } finally {
      if (requestId === starredRequestSeqRef.current) {
        setStarredLoading(false);
      }
    }
  };

  const searchRepos = async (query: string, reset = false, offsetOverride?: number) => {
    const requestId = ++searchRequestSeqRef.current;
    try {
      setSearching(true);
      const offset = typeof offsetOverride === 'number'
        ? offsetOverride
        : reset
          ? 0
          : searchOffset;
      const res = await rpc.explore.repos.$get({
        query: { q: query, limit: String(PAGE_SIZE), offset: String(offset), sort: searchSort, order: searchOrder },
      });
      const data = await rpcJson<{ repos?: SourceRepo[]; has_more?: boolean; total?: number }>(res);
      if (requestId !== searchRequestSeqRef.current) return;
      if (reset) {
        setSearchResults(data.repos || []);
        setSearchOffset(0);
      } else {
        setSearchResults((prev) => [...prev, ...(data.repos || [])]);
      }
      setSearchHasMore(!!data.has_more);
      setSearchTotal(data.total || 0);
    } catch (err) {
      if (requestId !== searchRequestSeqRef.current) return;
      console.error('Failed to search repos:', err);
    } finally {
      if (requestId === searchRequestSeqRef.current) {
        setSearching(false);
      }
    }
  };

  const handleCreateRepo = async (
    name: string,
    description: string,
    visibility: 'public' | 'private',
  ) => {
    if (!selectedWorkspaceId) return;
    try {
      const res = await rpc.spaces[':spaceId'].repos.$post({
        param: { spaceId: selectedWorkspaceId },
        json: { name, description, visibility },
      });
      await rpcJson(res);
      setShowCreateModal(false);
      void fetchMyRepos();
    } catch (err) {
      console.error('Failed to create repo:', err);
    }
  };

  const handleStar = async (repo: SourceRepo) => {
    try {
      if (repo.is_starred) {
        await rpc.repos[':repoId'].star.$delete({ param: { repoId: repo.id } });
      } else {
        await rpc.repos[':repoId'].star.$post({ param: { repoId: repo.id } });
      }

      const isNowStarred = !repo.is_starred;
      const updateRepoStar = (entry: SourceRepo) => {
        if (entry.id !== repo.id) return entry;
        const currentStars = entry.stars ?? entry.stars_count ?? 0;
        const nextStars = currentStars + (repo.is_starred ? -1 : 1);
        return {
          ...entry,
          is_starred: isNowStarred,
          stars: nextStars,
          stars_count: nextStars,
        };
      };

      setMyRepos((prev) => prev.map(updateRepoStar));
      setExploreRepos((prev) => prev.map(updateRepoStar));
      setSearchResults((prev) => prev.map(updateRepoStar));

      if (repo.is_starred) {
        setStarredRepos((prev) => prev.filter((entry) => entry.id !== repo.id));
        setStarredTotal((prev) => Math.max(0, prev - 1));
      } else {
        setStarredTotal((prev) => prev + 1);
      }
    } catch (err) {
      console.error('Failed to toggle star:', err);
    }
  };

  const loadMoreExplore = () => {
    if (exploreLoading || !exploreHasMore) return;
    const nextOffset = exploreOffset + PAGE_SIZE;
    setExploreOffset(nextOffset);
    void fetchExploreRepos(false, nextOffset);
  };

  const loadMoreStarred = () => {
    if (starredLoading || !starredHasMore) return;
    const nextOffset = starredOffset + PAGE_SIZE;
    setStarredOffset(nextOffset);
    void fetchStarredRepos(false, nextOffset);
  };

  const loadMoreSearch = () => {
    if (searching || !searchHasMore) return;
    const nextOffset = searchOffset + PAGE_SIZE;
    setSearchOffset(nextOffset);
    void searchRepos(searchQuery, false, nextOffset);
  };

  return {
    activeTab,
    setActiveTab,
    myRepos,
    myReposLoading,
    myReposError,
    exploreRepos,
    exploreLoading,
    exploreSort,
    setExploreSort,
    exploreHasMore,
    exploreTotal,
    starredRepos,
    starredLoading,
    starredHasMore,
    starredTotal,
    searchQuery,
    setSearchQuery,
    searchResults,
    searching,
    searchSort,
    setSearchSort,
    searchOrder,
    setSearchOrder,
    searchHasMore,
    searchTotal,
    showCreateModal,
    setShowCreateModal,
    loadMoreExplore,
    loadMoreStarred,
    loadMoreSearch,
    handleCreateRepo,
    handleStar,
  };
}
