import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import type {
  ExploreSort,
  SearchOrder,
  SearchSort,
  SourceRepo,
  SourceTab,
} from "../types/repos.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";

interface UseReposDataOptions {
  selectedSpaceId?: Accessor<string | undefined>;
  initialTab: SourceTab;
}

export function useReposData(
  { selectedSpaceId, initialTab }: UseReposDataOptions,
) {
  const [activeTab, setActiveTab] = createSignal<SourceTab>(initialTab);
  const PAGE_SIZE = 20;
  let myReposRequestSeq = 0;
  let exploreRequestSeq = 0;
  let starredRequestSeq = 0;
  let searchRequestSeq = 0;

  const [myRepos, setMyRepos] = createSignal<SourceRepo[]>([]);
  const [myReposLoading, setMyReposLoading] = createSignal(true);
  const [myReposError, setMyReposError] = createSignal<string | null>(null);

  const [exploreRepos, setExploreRepos] = createSignal<SourceRepo[]>([]);
  const [exploreLoading, setExploreLoading] = createSignal(false);
  const [exploreSort, setExploreSort] = createSignal<ExploreSort>("trending");
  const [exploreOffset, setExploreOffset] = createSignal(0);
  const [exploreHasMore, setExploreHasMore] = createSignal(false);
  const [exploreTotal, setExploreTotal] = createSignal(0);

  const [starredRepos, setStarredRepos] = createSignal<SourceRepo[]>([]);
  const [starredLoading, setStarredLoading] = createSignal(false);
  const [starredOffset, setStarredOffset] = createSignal(0);
  const [starredHasMore, setStarredHasMore] = createSignal(false);
  const [starredTotal, setStarredTotal] = createSignal(0);

  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<SourceRepo[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [searchSort, setSearchSort] = createSignal<SearchSort>("stars");
  const [searchOrder, setSearchOrder] = createSignal<SearchOrder>("desc");
  const [searchOffset, setSearchOffset] = createSignal(0);
  const [searchHasMore, setSearchHasMore] = createSignal(false);
  const [searchTotal, setSearchTotal] = createSignal(0);

  const [showCreateModal, setShowCreateModal] = createSignal(false);

  const fetchMyRepos = async () => {
    const currentSpaceId = selectedSpaceId?.();
    if (!currentSpaceId) return;
    const requestId = ++myReposRequestSeq;
    try {
      setMyReposLoading(true);
      setMyReposError(null);
      const res = await rpc.spaces[":spaceId"].repos.$get({
        param: { spaceId: currentSpaceId },
      });
      const data = await rpcJson<{ repositories?: SourceRepo[] }>(res);
      if (requestId !== myReposRequestSeq) return;
      if (selectedSpaceId?.() !== currentSpaceId) return;
      setMyRepos(data.repositories || []);
    } catch (err) {
      if (requestId !== myReposRequestSeq) return;
      if (selectedSpaceId?.() !== currentSpaceId) return;
      setMyReposError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (
        requestId === myReposRequestSeq &&
        selectedSpaceId?.() === currentSpaceId
      ) {
        setMyReposLoading(false);
      }
    }
  };

  const fetchExploreRepos = async (reset = false, offsetOverride?: number) => {
    const requestId = ++exploreRequestSeq;
    try {
      setExploreLoading(true);
      const offset = typeof offsetOverride === "number"
        ? offsetOverride
        : reset
        ? 0
        : exploreOffset();
      const res = await rpc.explore.repos.$get({
        query: {
          sort: exploreSort(),
          limit: String(PAGE_SIZE),
          offset: String(offset),
        },
      });
      const data = await rpcJson<
        { repos?: SourceRepo[]; has_more?: boolean; total?: number }
      >(res);
      if (requestId !== exploreRequestSeq) return;
      if (reset) {
        setExploreRepos(data.repos || []);
        setExploreOffset(0);
      } else {
        setExploreRepos((prev) => [...prev, ...(data.repos || [])]);
      }
      setExploreHasMore(!!data.has_more);
      setExploreTotal(data.total || 0);
    } catch (err) {
      if (requestId !== exploreRequestSeq) return;
      console.error("Failed to fetch explore repos:", err);
    } finally {
      if (requestId === exploreRequestSeq) {
        setExploreLoading(false);
      }
    }
  };

  const fetchStarredRepos = async (reset = false, offsetOverride?: number) => {
    const requestId = ++starredRequestSeq;
    try {
      setStarredLoading(true);
      const offset = typeof offsetOverride === "number"
        ? offsetOverride
        : reset
        ? 0
        : starredOffset();
      const res = await rpc.repos.starred.$get({
        query: { limit: String(PAGE_SIZE), offset: String(offset) },
      });
      const data = await rpcJson<
        { repos?: SourceRepo[]; has_more?: boolean; total?: number }
      >(res);
      if (requestId !== starredRequestSeq) return;
      if (reset) {
        setStarredRepos(data.repos || []);
        setStarredOffset(0);
      } else {
        setStarredRepos((prev) => [...prev, ...(data.repos || [])]);
      }
      setStarredHasMore(!!data.has_more);
      setStarredTotal(data.total || 0);
    } catch (err) {
      if (requestId !== starredRequestSeq) return;
      console.error("Failed to fetch starred repos:", err);
    } finally {
      if (requestId === starredRequestSeq) {
        setStarredLoading(false);
      }
    }
  };

  const searchRepos = async (
    query: string,
    reset = false,
    offsetOverride?: number,
  ) => {
    const requestId = ++searchRequestSeq;
    try {
      setSearching(true);
      const offset = typeof offsetOverride === "number"
        ? offsetOverride
        : reset
        ? 0
        : searchOffset();
      const res = await rpc.explore.repos.$get({
        query: {
          q: query,
          limit: String(PAGE_SIZE),
          offset: String(offset),
          sort: searchSort(),
          order: searchOrder(),
        },
      });
      const data = await rpcJson<
        { repos?: SourceRepo[]; has_more?: boolean; total?: number }
      >(res);
      if (requestId !== searchRequestSeq) return;
      if (reset) {
        setSearchResults(data.repos || []);
        setSearchOffset(0);
      } else {
        setSearchResults((prev) => [...prev, ...(data.repos || [])]);
      }
      setSearchHasMore(!!data.has_more);
      setSearchTotal(data.total || 0);
    } catch (err) {
      if (requestId !== searchRequestSeq) return;
      console.error("Failed to search repos:", err);
    } finally {
      if (requestId === searchRequestSeq) {
        setSearching(false);
      }
    }
  };

  // Fetch my repos when selectedSpaceId or activeTab changes
  createEffect(on(
    () => [selectedSpaceId?.(), activeTab()],
    () => {
      const currentSpaceId = selectedSpaceId?.();
      if (currentSpaceId && activeTab() === "repos") {
        void fetchMyRepos();
        return;
      }

      if (!currentSpaceId) {
        setMyRepos([]);
        setMyReposLoading(false);
        setMyReposError(null);
      }
    },
  ));

  // Fetch explore repos when activeTab or exploreSort changes
  createEffect(on(
    () => [activeTab(), exploreSort()],
    () => {
      if (activeTab() === "explore") {
        void fetchExploreRepos(true);
      }
    },
  ));

  // Fetch starred repos when activeTab changes
  createEffect(on(
    () => activeTab(),
    () => {
      if (activeTab() === "starred") {
        void fetchStarredRepos(true);
      }
    },
  ));

  // Search repos with debounce
  createEffect(() => {
    const q = searchQuery();
    const sortVal = searchSort();
    const orderVal = searchOrder();

    if (!q.trim()) {
      searchRequestSeq += 1;
      setSearchResults([]);
      setSearchTotal(0);
      setSearchHasMore(false);
      return;
    }
    const timer = setTimeout(() => {
      void searchRepos(q, true);
    }, 300);
    onCleanup(() => clearTimeout(timer));

    // Track sort/order so the effect re-runs when they change
    void sortVal;
    void orderVal;
  });

  const handleCreateRepo = async (
    name: string,
    description: string,
    visibility: "public" | "private",
  ) => {
    const currentSpaceId = selectedSpaceId?.();
    if (!currentSpaceId) return;
    try {
      const res = await rpc.spaces[":spaceId"].repos.$post({
        param: { spaceId: currentSpaceId },
        json: { name, description, visibility },
      });
      await rpcJson(res);
      setShowCreateModal(false);
      void fetchMyRepos();
    } catch (err) {
      console.error("Failed to create repo:", err);
    }
  };

  const handleStar = async (repo: SourceRepo) => {
    try {
      if (repo.is_starred) {
        await rpc.repos[":repoId"].star.$delete({ param: { repoId: repo.id } });
      } else {
        await rpc.repos[":repoId"].star.$post({ param: { repoId: repo.id } });
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
      console.error("Failed to toggle star:", err);
    }
  };

  const loadMoreExplore = () => {
    if (exploreLoading() || !exploreHasMore()) return;
    const nextOffset = exploreOffset() + PAGE_SIZE;
    setExploreOffset(nextOffset);
    void fetchExploreRepos(false, nextOffset);
  };

  const loadMoreStarred = () => {
    if (starredLoading() || !starredHasMore()) return;
    const nextOffset = starredOffset() + PAGE_SIZE;
    setStarredOffset(nextOffset);
    void fetchStarredRepos(false, nextOffset);
  };

  const loadMoreSearch = () => {
    if (searching() || !searchHasMore()) return;
    const nextOffset = searchOffset() + PAGE_SIZE;
    setSearchOffset(nextOffset);
    void searchRepos(searchQuery(), false, nextOffset);
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
