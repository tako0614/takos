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
  installableOnly: boolean;
  filter: string;
  onNavigateToRepo: (username: string, repoName: string) => void;
  onRequireLogin: () => void;
  // Pagination state setters
  setItems: React.Dispatch<React.SetStateAction<SourceItem[]>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  setSelectedItem: React.Dispatch<React.SetStateAction<SourceItem | null>>;
  setInstallingId: React.Dispatch<React.SetStateAction<string | null>>;
  requestSeqRef: React.MutableRefObject<number>;
  appendInFlightRef: React.MutableRefObject<boolean>;
}

export interface UseSourceFetchResult {
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
  installableOnly,
  filter,
  onNavigateToRepo,
  onRequireLogin,
  setItems,
  setLoading,
  setHasMore,
  setTotal,
  setSelectedItem,
  setInstallingId,
  requestSeqRef,
  appendInFlightRef,
}: UseSourceFetchOptions): UseSourceFetchResult {
  const queries = useSourceFetchQueries({
    isAuthenticated,
    effectiveSpaceId,
    debouncedQuery,
    sort,
    category,
    installableOnly,
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
    ...queries,
    ...actions,
  };
}
