import { useRef, useState } from 'react';
import type {
  SourceItem,
  SourceItemInstallation,
  SourceItemTakopack,
} from './useSourceData';
import { useSourceFetchQueries } from './useSourceFetchQueries';
import { useSourceFetchActions } from './useSourceFetchActions';

export interface UseSourceFetchOptions {
  isAuthenticated: boolean;
  effectiveSpaceId: string | null;
  debouncedQuery: string;
  sort: string;
  category: string;
  officialOnly: boolean;
  filter: string;
  onNavigateToRepo: (username: string, repoName: string) => void;
  onRequireLogin: () => void;
}

export interface UseSourceFetchResult {
  // Owned state
  items: SourceItem[];
  setItems: React.Dispatch<React.SetStateAction<SourceItem[]>>;
  loading: boolean;
  hasMore: boolean;
  total: number;
  selectedItem: SourceItem | null;
  setSelectedItem: React.Dispatch<React.SetStateAction<SourceItem | null>>;
  installingId: string | null;
  requestSeqRef: React.MutableRefObject<number>;
  appendInFlightRef: React.MutableRefObject<boolean>;
  // Actions
  fetchInstallations: () => Promise<Map<string, SourceItemInstallation>>;
  fetchAll: (offset?: number, append?: boolean, requestId?: number) => Promise<void>;
  fetchMine: (requestId?: number) => Promise<void>;
  fetchStarred: (offset?: number, append?: boolean, requestId?: number) => Promise<void>;
  install: (item: SourceItem) => Promise<void>;
  uninstall: (item: SourceItem) => Promise<void>;
  rollback: (item: SourceItem) => Promise<void>;
  toggleStar: (item: SourceItem) => Promise<void>;
  createRepo: (name: string, description: string, visibility: 'public' | 'private') => Promise<boolean>;
  openRepo: (item: SourceItem) => void;
  getItemTakopack: (item: SourceItem) => SourceItemTakopack;
}

export function useSourceFetch({
  isAuthenticated,
  effectiveSpaceId,
  debouncedQuery,
  sort,
  category,
  officialOnly,
  filter,
  onNavigateToRepo,
  onRequireLogin,
}: UseSourceFetchOptions): UseSourceFetchResult {
  // Own the state that was previously passed in
  const [items, setItems] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [selectedItem, setSelectedItem] = useState<SourceItem | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const requestSeqRef = useRef(0);
  const appendInFlightRef = useRef(false);

  const queries = useSourceFetchQueries({
    isAuthenticated,
    effectiveSpaceId,
    debouncedQuery,
    sort,
    category,
    officialOnly,
    setItems,
    setLoading,
    setHasMore,
    setTotal,
    setSelectedItem,
    requestSeqRef,
    appendInFlightRef,
  });

  const actions = useSourceFetchActions({
    isAuthenticated,
    effectiveSpaceId,
    filter,
    onNavigateToRepo,
    onRequireLogin,
    setItems,
    setSelectedItem,
    setInstallingId,
    requestSeqRef,
    fetchMine: queries.fetchMine,
  });

  return {
    // Owned state
    items,
    setItems,
    loading,
    hasMore,
    total,
    selectedItem,
    setSelectedItem,
    installingId,
    requestSeqRef,
    appendInFlightRef,
    // Actions
    ...queries,
    ...actions,
  };
}
