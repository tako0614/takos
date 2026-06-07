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
import { createLatestRequest } from "../lib/createLatestRequest.ts";
import { createPaginatedListResource } from "./createPaginatedListResource.ts";
import { useI18n } from "../store/i18n.ts";

interface UseReposDataOptions {
  selectedSpaceId?: Accessor<string | undefined>;
  initialTab: SourceTab;
}

interface PaginatedReposResponse {
  repos?: SourceRepo[];
  has_more?: boolean;
  total?: number;
}

export function useReposData(
  { selectedSpaceId, initialTab }: UseReposDataOptions,
) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = createSignal<SourceTab>(initialTab);
  const PAGE_SIZE = 20;
  const latestMyRepos = createLatestRequest();

  const [myRepos, setMyRepos] = createSignal<SourceRepo[]>([]);
  const [myReposLoading, setMyReposLoading] = createSignal(true);
  const [myReposError, setMyReposError] = createSignal<string | null>(null);

  const [exploreSort, setExploreSort] = createSignal<ExploreSort>("trending");

  // Explore tab is reset whenever the sort changes; the sort value doubles as
  // the resource source so a sort change clears the list before the next fetch.
  const explore = createPaginatedListResource<SourceRepo>({
    source: exploreSort,
    initialError: t("unknownError"),
    perPage: PAGE_SIZE,
    fetchPage: async ({ offset, limit }) => {
      const res = await rpc.explore.repos.$get({
        query: {
          sort: exploreSort(),
          limit: String(limit),
          offset: String(offset),
        },
      });
      const data = await rpcJson<PaginatedReposResponse>(res);
      return { items: data.repos || [], hasMore: !!data.has_more };
    },
  });

  // Starred repos have no per-source dimension, so use a constant non-empty
  // source (the resource early-returns on an empty source).
  const starred = createPaginatedListResource<SourceRepo>({
    source: () => "starred",
    initialError: t("unknownError"),
    perPage: PAGE_SIZE,
    fetchPage: async ({ offset, limit }) => {
      const res = await rpc.repos.starred.$get({
        query: { limit: String(limit), offset: String(offset) },
      });
      const data = await rpcJson<PaginatedReposResponse>(res);
      return { items: data.repos || [], hasMore: !!data.has_more };
    },
  });
  const [starredTotal, setStarredTotal] = createSignal(0);

  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchSort, setSearchSort] = createSignal<SearchSort>("stars");
  const [searchOrder, setSearchOrder] = createSignal<SearchOrder>("desc");
  const [searchTotal, setSearchTotal] = createSignal(0);

  // Search is keyed by the query; sort/order are read at fetch time and tracked
  // by the debounce effect so a change re-runs the search for the same query.
  const search = createPaginatedListResource<SourceRepo>({
    source: searchQuery,
    initialError: t("unknownError"),
    perPage: PAGE_SIZE,
    fetchPage: async ({ source, offset, limit }) => {
      const res = await rpc.explore.repos.$get({
        query: {
          q: source,
          limit: String(limit),
          offset: String(offset),
          sort: searchSort(),
          order: searchOrder(),
        },
      });
      const data = await rpcJson<PaginatedReposResponse>(res);
      // Only commit total for the still-current query (mirrors the resource's
      // own latest-wins guard, which only gates items/hasMore).
      if (source === searchQuery()) {
        setSearchTotal(data.total || 0);
      }
      return { items: data.repos || [], hasMore: !!data.has_more };
    },
  });

  const [showCreateModal, setShowCreateModal] = createSignal(false);

  const fetchMyRepos = async () => {
    const currentSpaceId = selectedSpaceId?.();
    if (!currentSpaceId) return;
    const claim = latestMyRepos.claim(() =>
      selectedSpaceId?.() === currentSpaceId
    );
    try {
      setMyReposLoading(true);
      setMyReposError(null);
      const res = await rpc.spaces[":spaceId"].repos.$get({
        param: { spaceId: currentSpaceId },
      });
      const data = await rpcJson<{ repositories?: SourceRepo[] }>(res);
      if (!claim.won()) return;
      setMyRepos(data.repositories || []);
    } catch (err) {
      if (!claim.won()) return;
      setMyReposError(err instanceof Error ? err.message : t("unknownError"));
    } finally {
      if (claim.won()) {
        setMyReposLoading(false);
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
        void explore.fetch(true);
      }
    },
  ));

  // Fetch starred repos when activeTab changes
  createEffect(on(
    () => activeTab(),
    () => {
      if (activeTab() === "starred") {
        void starred.fetch(true);
      }
    },
  ));

  // Search repos with debounce
  createEffect(() => {
    const q = searchQuery();
    const sortVal = searchSort();
    const orderVal = searchOrder();

    if (!q.trim()) {
      search.reset();
      setSearchTotal(0);
      return;
    }
    const timer = setTimeout(() => {
      void search.fetch(true);
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
      explore.updateItems(updateRepoStar);
      search.updateItems(updateRepoStar);

      if (repo.is_starred) {
        starred.filterItems((entry) => entry.id !== repo.id);
        setStarredTotal((prev) => Math.max(0, prev - 1));
      } else {
        setStarredTotal((prev) => prev + 1);
      }
    } catch (err) {
      console.error("Failed to toggle star:", err);
    }
  };

  const loadMoreExplore = () => {
    void explore.fetch(false);
  };

  const loadMoreStarred = () => {
    void starred.fetch(false);
  };

  const loadMoreSearch = () => {
    void search.fetch(false);
  };

  return {
    activeTab,
    setActiveTab,
    myRepos,
    myReposLoading,
    myReposError,
    exploreRepos: explore.items,
    exploreLoading: explore.loading,
    exploreSort,
    setExploreSort,
    exploreHasMore: explore.hasMore,
    starredRepos: starred.items,
    starredLoading: starred.loading,
    starredHasMore: starred.hasMore,
    starredTotal,
    searchQuery,
    setSearchQuery,
    searchResults: search.items,
    searching: search.loading,
    searchSort,
    setSearchSort,
    searchOrder,
    setSearchOrder,
    searchHasMore: search.hasMore,
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
