import { createSignal } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';
import type {
  SourceItem,
  SourceItemInstallation,
  SourceItemTakopack,
} from './useSourceData.ts';
import { useSourceFetchQueries } from './useSourceFetchQueries.ts';
import { useSourceFetchActions } from './useSourceFetchActions.ts';

export interface UseSourceFetchOptions {
  isAuthenticated: boolean;
  effectiveSpaceId: Accessor<string | null>;
  debouncedQuery: Accessor<string>;
  sort: Accessor<string>;
  category: Accessor<string>;
  officialOnly: Accessor<boolean>;
  filter: Accessor<string>;
  onNavigateToRepo: (username: string, repoName: string) => void;
  onRequireLogin: () => void;
}

export interface UseSourceFetchResult {
  // Owned state
  items: Accessor<SourceItem[]>;
  setItems: Setter<SourceItem[]>;
  loading: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  total: Accessor<number>;
  selectedItem: Accessor<SourceItem | null>;
  setSelectedItem: Setter<SourceItem | null>;
  installingId: Accessor<string | null>;
  requestSeqRef: number;
  appendInFlightRef: boolean;
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
  const [items, setItems] = createSignal<SourceItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [hasMore, setHasMore] = createSignal(false);
  const [total, setTotal] = createSignal(0);
  const [selectedItem, setSelectedItem] = createSignal<SourceItem | null>(null);
  const [installingId, setInstallingId] = createSignal<string | null>(null);
  let requestSeqRef = 0;
  let appendInFlightRef = false;

  // Create a mutable ref object so sub-hooks can read/write the same values
  const refs = { get requestSeqRef() { return requestSeqRef; }, set requestSeqRef(v: number) { requestSeqRef = v; }, get appendInFlightRef() { return appendInFlightRef; }, set appendInFlightRef(v: boolean) { appendInFlightRef = v; } };

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
    refs,
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
    refs,
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
    get requestSeqRef() { return requestSeqRef; },
    set requestSeqRef(v: number) { requestSeqRef = v; },
    get appendInFlightRef() { return appendInFlightRef; },
    set appendInFlightRef(v: boolean) { appendInFlightRef = v; },
    // Actions
    ...queries,
    ...actions,
  };
}
