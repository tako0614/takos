import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../providers/I18nProvider';
import { rpc, rpcJson } from '../lib/rpc';
import { getPersonalWorkspace, getWorkspaceIdentifier } from '../lib/workspaces';
import { useToast } from './useToast';
import type { Workspace } from '../types';

export type SourceFilter = 'all' | 'mine' | 'starred';
export type SourceSort = 'trending' | 'new' | 'stars' | 'updated';

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
  visibility: 'public' | 'private';
  default_branch?: string | null;
  updated_at: string;
  stars: number;
  forks: number;
  language?: string | null;
  license?: string | null;
  category?: string | null;
  is_starred: boolean;
  is_mine: boolean;
  owner: {
    id?: string;
    name: string;
    username: string;
    avatar_url?: string | null;
  };
  workspace?: { id: string; name: string };
  takopack?: SourceItemTakopack;
  installation?: SourceItemInstallation;
}

export interface CatalogSuggestionUser {
  username: string;
  name: string | null;
  avatar_url: string | null;
}

export interface CatalogSuggestionRepo {
  id: string;
  name: string;
  description: string | null;
  stars: number;
  updated_at: string;
  owner: {
    username: string;
    name: string | null;
    avatar_url: string | null;
  };
}

interface CatalogSuggestions {
  users: CatalogSuggestionUser[];
  repos: CatalogSuggestionRepo[];
}

interface UseSourceDataOptions {
  workspaces: Workspace[];
  onNavigateToRepo: (username: string, repoName: string) => void;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

const PAGE_SIZE = 20;
const SOURCE_STATE_KEY = 'takos.source.state.v1';

type PersistedSourceState = {
  filter: SourceFilter;
  sort: SourceSort;
  category: string;
  installableOnly: boolean;
  query: string;
  selectedWorkspaceId: string | null;
};

const ALLOWED_FILTERS: SourceFilter[] = ['all', 'mine', 'starred'];
const ALLOWED_SORTS: SourceSort[] = ['trending', 'new', 'stars', 'updated'];

function readPersistedSourceState(): Partial<PersistedSourceState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(SOURCE_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedSourceState>;
    return {
      filter: ALLOWED_FILTERS.includes(parsed.filter as SourceFilter) ? parsed.filter : undefined,
      sort: ALLOWED_SORTS.includes(parsed.sort as SourceSort) ? parsed.sort : undefined,
      category: typeof parsed.category === 'string' ? parsed.category : undefined,
      installableOnly: typeof parsed.installableOnly === 'boolean' ? parsed.installableOnly : undefined,
      query: typeof parsed.query === 'string' ? parsed.query : undefined,
      selectedWorkspaceId: typeof parsed.selectedWorkspaceId === 'string'
        ? parsed.selectedWorkspaceId
        : parsed.selectedWorkspaceId === null
          ? null
          : undefined,
    };
  } catch {
    return {};
  }
}

function writePersistedSourceState(state: PersistedSourceState) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SOURCE_STATE_KEY, JSON.stringify(state));
  } catch {
    // noop
  }
}

function makeEmptyTakopack(): SourceItemTakopack {
  return {
    available: false,
    latest_version: null,
    latest_tag: null,
    release_tag: null,
    asset_id: null,
    tags: [],
    downloads: 0,
    certified: false,
    description: null,
  };
}

export function useSourceData({ workspaces, onNavigateToRepo, isAuthenticated, onRequireLogin }: UseSourceDataOptions) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const persistedState = useState(() => readPersistedSourceState())[0];

  const [filter, setFilter] = useState<SourceFilter>(persistedState.filter ?? 'all');
  const [sort, setSort] = useState<SourceSort>(persistedState.sort ?? 'trending');
  const [category, setCategory] = useState(persistedState.category ?? '');
  const [installableOnly, setInstallableOnly] = useState(persistedState.installableOnly ?? false);
  const [query, setQuery] = useState(persistedState.query ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    persistedState.selectedWorkspaceId ?? null,
  );
  const spaceIds = useMemo(
    () => new Set(workspaces.map((workspace) => getWorkspaceIdentifier(workspace))),
    [workspaces],
  );
  const effectiveWorkspaceId = isAuthenticated
    && selectedWorkspaceId
    && spaceIds.has(selectedWorkspaceId)
    ? selectedWorkspaceId
    : null;

  const [items, setItems] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  const [selectedItem, setSelectedItem] = useState<SourceItem | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const [searchFocused, setSearchFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<CatalogSuggestions>({ users: [], repos: [] });
  const [suggesting, setSuggesting] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const requestSeqRef = useRef(0);
  const suggestionRequestSeqRef = useRef(0);
  const appendInFlightRef = useRef(false);

  // Initialize workspace and validate persisted workspace selection against current auth/spaces.
  useEffect(() => {
    if (!isAuthenticated) {
      if (selectedWorkspaceId !== null) {
        setSelectedWorkspaceId(null);
      }
      return;
    }
    if (workspaces.length === 0) return;

    if (selectedWorkspaceId && spaceIds.has(selectedWorkspaceId)) {
      return;
    }

    const personal = getPersonalWorkspace(workspaces, t('personal'));
    setSelectedWorkspaceId(
      personal ? getWorkspaceIdentifier(personal) : getWorkspaceIdentifier(workspaces[0]),
    );
  }, [isAuthenticated, workspaces, selectedWorkspaceId, spaceIds, t]);

  useEffect(() => {
    writePersistedSourceState({
      filter,
      sort,
      category,
      installableOnly,
      query,
      selectedWorkspaceId: effectiveWorkspaceId,
    });
  }, [category, effectiveWorkspaceId, filter, installableOnly, query, sort]);

  // Fetch installation map from workspace app deployments
  const fetchInstallations = useCallback(async (): Promise<Map<string, SourceItemInstallation>> => {
    if (!isAuthenticated || !effectiveWorkspaceId) return new Map();
    try {
      const response = await fetch(`/api/spaces/${effectiveWorkspaceId}/app-deployments`);
      if (!response.ok) throw new Error('Failed to fetch app deployments');
      const data = await rpcJson<{
        data: Array<{
          id: string;
          version: string;
          deployed_at: string;
          source?: { repo_id?: string | null } | null;
        }>;
      }>(response);
      const map = new Map<string, SourceItemInstallation>();
      for (const pkg of data.data || []) {
        const repoId = pkg.source?.repo_id || null;
        if (repoId) {
          map.set(repoId, {
            installed: true,
            app_deployment_id: pkg.id,
            installed_version: pkg.version,
            deployed_at: pkg.deployed_at,
          });
        }
      }
      return map;
    } catch {
      return new Map();
    }
  }, [effectiveWorkspaceId, isAuthenticated]);

  // Fetch catalog (all filter)
  const fetchAll = useCallback(
    async (offset = 0, append = false, requestId = requestSeqRef.current) => {
      if (requestId !== requestSeqRef.current) return;
      try {
        setLoading(true);
        const queryParams: Record<string, string> = {
          limit: String(PAGE_SIZE),
          offset: String(offset),
          sort,
          type: installableOnly ? 'deployable-app' : 'all',
        };
        if (debouncedQuery.trim()) queryParams.q = debouncedQuery.trim();
        if (category) queryParams.category = category;
        if (effectiveWorkspaceId) queryParams.space_id = effectiveWorkspaceId;

        const [catalogResponse, installMap] = await Promise.all([
          rpc.explore.catalog.$get({ query: queryParams }),
          fetchInstallations(),
        ]);

        const data = await rpcJson<{
          items: Array<{
            repo: {
              id: string;
              name: string;
              description: string | null;
              visibility: 'public';
              default_branch: string;
              stars: number;
              forks: number;
              category: string | null;
              language: string | null;
              license: string | null;
              is_starred: boolean;
              created_at: string;
              updated_at: string;
              workspace: { id: string; name: string };
              owner: { id: string; name: string; username: string; avatar_url: string | null };
            };
            takopack: {
              available: boolean;
              latest_version: string | null;
              latest_tag: string | null;
              release_id: string | null;
              release_tag: string | null;
              asset_id: string | null;
              description: string | null;
              icon: string | null;
              category: string | null;
              tags: string[];
              downloads: number;
              rating_avg: number | null;
              rating_count: number;
              publish_status: string;
              certified: boolean;
              published_at: string | null;
            };
            installation?: {
              installed: boolean;
              app_deployment_id: string | null;
              installed_version: string | null;
              deployed_at: string | null;
            };
          }>;
          total: number;
          has_more: boolean;
        }>(catalogResponse);

        if (requestId !== requestSeqRef.current) return;

        const newItems: SourceItem[] = (data.items || []).map((item) => ({
          id: item.repo.id,
          name: item.repo.name,
          description: item.repo.description,
          visibility: item.repo.visibility,
          default_branch: item.repo.default_branch,
          updated_at: item.repo.updated_at,
          stars: item.repo.stars,
          forks: item.repo.forks,
          language: item.repo.language,
          license: item.repo.license,
          category: item.repo.category,
          is_starred: item.repo.is_starred,
          is_mine: false,
          owner: item.repo.owner,
          workspace: item.repo.workspace,
          takopack: {
            available: item.takopack.available,
            latest_version: item.takopack.latest_version,
            latest_tag: item.takopack.latest_tag,
            release_tag: item.takopack.release_tag,
            asset_id: item.takopack.asset_id,
            tags: item.takopack.tags,
            downloads: item.takopack.downloads,
            certified: item.takopack.certified,
            description: item.takopack.description,
          },
          installation: installMap.get(item.repo.id) ?? item.installation,
        }));

        setItems((prev) => (append
          ? [...prev, ...newItems.filter((item) => !prev.some((existing) => existing.id === item.id))]
          : newItems));
        setHasMore(Boolean(data.has_more));
        setTotal(data.total || 0);
      } catch (error) {
        if (requestId !== requestSeqRef.current) return;
        console.error('Failed to fetch catalog:', error);
        setHasMore(false);
        if (!append) {
          setItems([]);
          setSelectedItem(null);
          setTotal(0);
        }
      } finally {
        if (requestId === requestSeqRef.current) {
          setLoading(false);
        }
        if (append) {
          appendInFlightRef.current = false;
        }
      }
    },
    [debouncedQuery, sort, category, installableOnly, effectiveWorkspaceId, fetchInstallations],
  );

  // Fetch my repos (mine filter)
  const fetchMine = useCallback(async (requestId = requestSeqRef.current) => {
    if (requestId !== requestSeqRef.current) return;
    if (!isAuthenticated) {
      setItems([]);
      setSelectedItem(null);
      setHasMore(false);
      setTotal(0);
      return;
    }
    if (!effectiveWorkspaceId) {
      setItems([]);
      setSelectedItem(null);
      setHasMore(false);
      setTotal(0);
      return;
    }
    try {
      setLoading(true);
      const [reposResponse, installMap] = await Promise.all([
        rpc.spaces[':spaceId'].repos.$get({
          param: { spaceId: effectiveWorkspaceId },
        }),
        fetchInstallations(),
      ]);
      const data = await rpcJson<{
        repositories: Array<{
          id: string;
          name: string;
          description: string | null;
          visibility: 'public' | 'private';
          updated_at: string;
          stars?: number;
          stars_count?: number;
          forks?: number;
          forks_count?: number;
          is_starred?: boolean;
          owner?: {
            id?: string;
            name: string;
            username?: string | null;
            avatar_url: string | null;
          };
        }>;
      }>(reposResponse);

      if (requestId !== requestSeqRef.current) return;

      let repos = data.repositories || [];
      if (debouncedQuery.trim()) {
        const q = debouncedQuery.toLowerCase();
        repos = repos.filter(
          (r) => r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q),
        );
      }

      const newItems: SourceItem[] = repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        description: repo.description,
        visibility: repo.visibility,
        default_branch: 'main',
        updated_at: repo.updated_at,
        stars: repo.stars_count ?? repo.stars ?? 0,
        forks: repo.forks_count ?? repo.forks ?? 0,
        is_starred: repo.is_starred ?? false,
        is_mine: true,
        owner: repo.owner
          ? {
              id: repo.owner.id,
              name: repo.owner.name || repo.owner.username || 'unknown',
              username: repo.owner.username || '',
              avatar_url: repo.owner.avatar_url ?? null,
            }
          : { name: 'unknown', username: '' },
        installation: installMap.get(repo.id),
      }));

      setItems(newItems);
      setHasMore(false);
      setTotal(newItems.length);
    } catch (error) {
      if (requestId !== requestSeqRef.current) return;
      console.error('Failed to fetch my repos:', error);
      setItems([]);
      setSelectedItem(null);
      setHasMore(false);
      setTotal(0);
    } finally {
      if (requestId === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [isAuthenticated, effectiveWorkspaceId, debouncedQuery, fetchInstallations]);

  // Fetch starred repos (starred filter)
  const fetchStarred = useCallback(
    async (offset = 0, append = false, requestId = requestSeqRef.current) => {
      if (requestId !== requestSeqRef.current) return;
      if (!isAuthenticated) {
        if (!append) {
          setItems([]);
          setSelectedItem(null);
          setHasMore(false);
          setTotal(0);
        }
        return;
      }
      try {
        setLoading(true);
        const [reposResponse, installMap] = await Promise.all([
          rpc.repos.starred.$get({
            query: { limit: String(PAGE_SIZE), offset: String(offset) },
          }),
          fetchInstallations(),
        ]);
        const data = await rpcJson<{
          repos: Array<{
            id: string;
            name: string;
            description: string | null;
            visibility: 'public' | 'private';
            updated_at: string;
            stars?: number;
            stars_count?: number;
            forks?: number;
            forks_count?: number;
            is_starred?: boolean;
            owner?: {
              id?: string;
              name: string;
              username?: string | null;
              avatar_url: string | null;
            };
          }>;
          has_more?: boolean;
          total?: number;
        }>(reposResponse);

        if (requestId !== requestSeqRef.current) return;

        const newItems: SourceItem[] = (data.repos || []).map((repo) => ({
          id: repo.id,
          name: repo.name,
          description: repo.description,
          visibility: repo.visibility,
          default_branch: 'main',
          updated_at: repo.updated_at,
          stars: repo.stars_count ?? repo.stars ?? 0,
          forks: repo.forks_count ?? repo.forks ?? 0,
          is_starred: true,
          is_mine: false,
          owner: repo.owner
            ? {
                id: repo.owner.id,
                name: repo.owner.name,
                username: repo.owner.username || '',
                avatar_url: repo.owner.avatar_url,
              }
            : { name: 'unknown', username: '' },
          installation: installMap.get(repo.id),
        }));

        setItems((prev) => (append
          ? [...prev, ...newItems.filter((item) => !prev.some((existing) => existing.id === item.id))]
          : newItems));
        setHasMore(Boolean(data.has_more));
        setTotal(data.total || 0);
      } catch (error) {
        if (requestId !== requestSeqRef.current) return;
        console.error('Failed to fetch starred repos:', error);
        setHasMore(false);
        if (!append) {
          setItems([]);
          setSelectedItem(null);
          setTotal(0);
        }
      } finally {
        if (requestId === requestSeqRef.current) {
          setLoading(false);
        }
        if (append) {
          appendInFlightRef.current = false;
        }
      }
    },
    [isAuthenticated, fetchInstallations],
  );

  // Refetch whenever filter/sort/category/installableOnly/query/workspace changes
  const [, setOffset] = useState(0);

  useEffect(() => {
    appendInFlightRef.current = false;
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    setOffset(0);
    setItems([]);
    setSelectedItem(null);
    if (filter === 'all') {
      void fetchAll(0, false, requestId);
    } else if (filter === 'mine') {
      void fetchMine(requestId);
    } else {
      void fetchStarred(0, false, requestId);
    }
  }, [filter, sort, category, installableOnly, debouncedQuery, effectiveWorkspaceId, isAuthenticated, fetchAll, fetchMine, fetchStarred]);

  // Search suggestions
  useEffect(() => {
    const q = query.trim();
    if (!q || !searchFocused) {
      setSuggestions({ users: [], repos: [] });
      setSuggesting(false);
      suggestionRequestSeqRef.current += 1;
      return;
    }
    const currentRequestId = suggestionRequestSeqRef.current + 1;
    suggestionRequestSeqRef.current = currentRequestId;
    const timer = setTimeout(async () => {
      try {
        setSuggesting(true);
        const response = await rpc.explore.catalog.suggest.$get({ query: { q, limit: '6' } });
        const data = await rpcJson<CatalogSuggestions>(response);
        if (currentRequestId !== suggestionRequestSeqRef.current) return;
        setSuggestions({ users: data.users || [], repos: data.repos || [] });
      } catch {
        if (currentRequestId !== suggestionRequestSeqRef.current) return;
        setSuggestions({ users: [], repos: [] });
      } finally {
        if (currentRequestId === suggestionRequestSeqRef.current) {
          setSuggesting(false);
        }
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      if (currentRequestId === suggestionRequestSeqRef.current) {
        suggestionRequestSeqRef.current += 1;
      }
    };
  }, [query, searchFocused]);

  const loadMore = () => {
    if (loading || !hasMore || appendInFlightRef.current) return;
    appendInFlightRef.current = true;
    const requestId = requestSeqRef.current;
    setOffset((prevOffset) => {
      const nextOffset = prevOffset + PAGE_SIZE;
      if (filter === 'all') {
        void fetchAll(nextOffset, true, requestId);
      } else if (filter === 'starred') {
        void fetchStarred(nextOffset, true, requestId);
      }
      return nextOffset;
    });
  };

  // Actions

  const install = async (item: SourceItem) => {
    if (!isAuthenticated) {
      onRequireLogin();
      return;
    }
    if (!effectiveWorkspaceId) {
      showToast('error', t('selectWorkspaceFirst'));
      return;
    }
    if (!item.takopack?.available) {
      showToast('error', t('noDeployableAppManifest'));
      return;
    }
    try {
      setInstallingId(item.id);
      const response = await fetch(`/api/spaces/${effectiveWorkspaceId}/app-deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_id: item.id,
          ref: item.default_branch || 'main',
          ref_type: 'branch',
        }),
      });
      const data = await rpcJson<{ data?: { app_deployment_id?: string } }>(response);
      showToast('success', t('deployedItem', { name: item.name }));

      const installation: SourceItemInstallation = {
        installed: true,
        app_deployment_id: data.data?.app_deployment_id || null,
        installed_version: item.takopack.latest_version,
        deployed_at: new Date().toISOString(),
      };
      const updateItem = (i: SourceItem) => (i.id === item.id ? { ...i, installation } : i);
      setItems((prev) => prev.map(updateItem));
      setSelectedItem((prev) => (prev?.id === item.id ? updateItem(prev) : prev));
    } catch (error) {
      console.error('Failed to install:', error);
      showToast('error', t('installFailed'));
    } finally {
      setInstallingId(null);
    }
  };

  const uninstall = async (item: SourceItem) => {
    if (!isAuthenticated) {
      onRequireLogin();
      return;
    }
    if (!effectiveWorkspaceId || !item.installation?.app_deployment_id) return;
    try {
      const res = await fetch(
        `/api/spaces/${effectiveWorkspaceId}/app-deployments/${item.installation.app_deployment_id}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Failed to uninstall');
      showToast('success', t('uninstalledItem', { name: item.name }));
      const updateItem = (i: SourceItem) =>
        i.id === item.id ? { ...i, installation: undefined } : i;
      setItems((prev) => prev.map(updateItem));
      setSelectedItem((prev) => (prev?.id === item.id ? { ...prev, installation: undefined } : prev));
    } catch {
      showToast('error', t('uninstallFailed'));
    }
  };

  const rollback = async (item: SourceItem) => {
    if (!isAuthenticated) {
      onRequireLogin();
      return;
    }
    if (!effectiveWorkspaceId || !item.installation?.app_deployment_id) return;
    try {
      const res = await fetch(
        `/api/spaces/${effectiveWorkspaceId}/app-deployments/${item.installation.app_deployment_id}/rollback`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      if (!res.ok) throw new Error('Rollback failed');
      showToast('success', t('rolledBackItem', { name: item.name }));
    } catch {
      showToast('error', t('rollbackFailed'));
    }
  };

  const toggleStar = async (item: SourceItem) => {
    if (!isAuthenticated) {
      onRequireLogin();
      return;
    }
    try {
      if (item.is_starred) {
        await rpcJson(await rpc.repos[':repoId'].star.$delete({ param: { repoId: item.id } }));
      } else {
        await rpcJson(await rpc.repos[':repoId'].star.$post({ param: { repoId: item.id } }));
      }
      const delta = item.is_starred ? -1 : 1;
      const updateItem = (i: SourceItem) =>
        i.id === item.id
          ? { ...i, is_starred: !i.is_starred, stars: Math.max(0, i.stars + delta) }
          : i;
      setItems((prev) => {
        const updated = prev.map(updateItem);
        if (filter === 'starred' && item.is_starred) {
          return updated.filter((i) => i.id !== item.id);
        }
        return updated;
      });
      setSelectedItem((prev) => {
        if (prev?.id !== item.id) return prev;
        if (filter === 'starred' && item.is_starred) {
          return null;
        }
        return updateItem(prev);
      });
    } catch {
      showToast('error', t('failedToUpdateStar'));
    }
  };

  const createRepo = async (name: string, description: string, visibility: 'public' | 'private') => {
    if (!isAuthenticated) {
      onRequireLogin();
      return;
    }
    if (!effectiveWorkspaceId) return;
    try {
      const response = await rpc.spaces[':spaceId'].repos.$post({
        param: { spaceId: effectiveWorkspaceId },
        json: { name, description, visibility },
      });
      await rpcJson(response);
      showToast('success', t('repositoryCreated'));
      setShowCreateModal(false);
      if (filter === 'mine') {
        void fetchMine(requestSeqRef.current);
      }
    } catch {
      showToast('error', t('failedToCreateRepository'));
    }
  };

  const openRepo = (item: SourceItem) => {
    if (item.owner.username && item.name) {
      onNavigateToRepo(item.owner.username, item.name);
    }
  };

  // Expose a no-takopack placeholder so components always have a takopack field to check
  const getItemTakopack = (item: SourceItem): SourceItemTakopack =>
    item.takopack ?? makeEmptyTakopack();

  return {
    filter,
    setFilter,
    sort,
    setSort,
    category,
    setCategory,
    installableOnly,
    setInstallableOnly,
    query,
    setQuery,

    selectedWorkspaceId: effectiveWorkspaceId,
    setSelectedWorkspaceId,
    workspaces,

    items,
    loading,
    hasMore,
    total,

    selectedItem,
    setSelectedItem,
    installingId,

    searchFocused,
    setSearchFocused,
    suggestions,
    suggesting,

    showCreateModal,
    setShowCreateModal,

    loadMore,
    install,
    uninstall,
    rollback,
    toggleStar,
    createRepo,
    openRepo,
    getItemTakopack,
  };
}
