import { createEffect, on } from "solid-js";
import type { Space } from "../types/index.ts";
import { useSourceFiltering } from "./useSourceFiltering.ts";
import { useSourcePagination } from "./useSourcePagination.ts";
import { useSourceFetch } from "./useSourceFetch.ts";

export type { SourceFilter, SourceSort } from "./useSourceFiltering.ts";
export type {
  CatalogSuggestionRepo,
  CatalogSuggestionUser,
} from "./useSourceFiltering.ts";

export interface SourceItemTakopack {
  available: boolean;
  latest_version: string | null;
  latest_tag: string | null;
  release_tag: string | null;
  asset_id: string | null;
  tags: string[];
  downloads: number;
  certified: boolean;
  description: string | null;
}

export interface SourceItemInstallation {
  installed: boolean;
  app_deployment_id: string | null;
  installed_version: string | null;
  deployed_at: string | null;
}

export interface SourceItem {
  id: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  default_branch?: string | null;
  updated_at: string;
  stars: number;
  forks: number;
  language?: string | null;
  license?: string | null;
  category?: string | null;
  is_starred: boolean;
  is_mine: boolean;
  official?: boolean;
  owner: {
    id?: string;
    name: string;
    username: string;
    avatar_url?: string | null;
  };
  space?: { id: string; name: string };
  takopack?: SourceItemTakopack;
  installation?: SourceItemInstallation;
}

interface UseSourceDataOptions {
  spaces: () => Space[];
  onNavigateToRepo: (username: string, repoName: string) => void;
  isAuthenticated: () => boolean;
  onRequireLogin: () => void;
}

export function useSourceData(
  { spaces, onNavigateToRepo, isAuthenticated, onRequireLogin }:
    UseSourceDataOptions,
) {
  // --- Filtering sub-hook ---
  const filtering = useSourceFiltering({ spaces, isAuthenticated });

  // --- Pagination sub-hook (now only owns showCreateModal + loadMore logic) ---
  const pagination = useSourcePagination();

  // --- Fetch sub-hook (now owns items, loading, hasMore, total, selectedItem, installingId, refs) ---
  const fetching = useSourceFetch({
    isAuthenticated,
    effectiveSpaceId: filtering.effectiveSpaceId,
    debouncedQuery: filtering.debouncedQuery,
    sort: filtering.sort,
    category: filtering.category,
    officialOnly: filtering.officialOnly,
    filter: filtering.filter,
    onNavigateToRepo,
    onRequireLogin,
  });

  // Refetch whenever filter/sort/category/officialOnly/query/space changes
  createEffect(on(
    () => [
      filtering.filter(),
      filtering.sort(),
      filtering.category(),
      filtering.officialOnly(),
      filtering.debouncedQuery(),
      filtering.effectiveSpaceId(),
      isAuthenticated(),
    ],
    () => {
      fetching.appendInFlightRef = false;
      const requestId = fetching.requestSeqRef + 1;
      fetching.requestSeqRef = requestId;
      fetching.setItems([]);
      fetching.setSelectedItem(null);
      pagination.resetOffset();
      if (filtering.filter() === "all") {
        void fetching.fetchAll(0, false, requestId);
      } else if (filtering.filter() === "mine") {
        void fetching.fetchMine(requestId);
      } else {
        void fetching.fetchStarred(0, false, requestId);
      }
    },
  ));

  const loadMore = () => {
    pagination.loadMore(
      filtering.filter(),
      fetching.loading(),
      fetching.hasMore(),
      fetching,
      fetching,
      fetching.fetchAll,
      fetching.fetchStarred,
    );
  };

  const createRepo = async (
    name: string,
    description: string,
    visibility: "public" | "private",
  ) => {
    const success = await fetching.createRepo(name, description, visibility);
    if (success) {
      pagination.setShowCreateModal(false);
    }
  };

  return {
    filter: filtering.filter,
    setFilter: filtering.setFilter,
    sort: filtering.sort,
    setSort: filtering.setSort,
    category: filtering.category,
    setCategory: filtering.setCategory,
    officialOnly: filtering.officialOnly,
    setOfficialOnly: filtering.setOfficialOnly,
    query: filtering.query,
    setQuery: filtering.setQuery,

    selectedSpaceId: filtering.effectiveSpaceId,
    setSelectedSpaceId: filtering.setSelectedSpaceId,

    items: fetching.items,
    loading: fetching.loading,
    hasMore: fetching.hasMore,
    total: fetching.total,

    selectedItem: fetching.selectedItem,
    setSelectedItem: fetching.setSelectedItem,
    installingId: fetching.installingId,

    searchFocused: filtering.searchFocused,
    setSearchFocused: filtering.setSearchFocused,
    suggestions: filtering.suggestions,
    suggesting: filtering.suggesting,

    showCreateModal: pagination.showCreateModal,
    setShowCreateModal: pagination.setShowCreateModal,

    loadMore,
    install: fetching.install,
    uninstall: fetching.uninstall,
    rollback: fetching.rollback,
    toggleStar: fetching.toggleStar,
    createRepo,
    openRepo: fetching.openRepo,
    getItemTakopack: fetching.getItemTakopack,
  };
}
