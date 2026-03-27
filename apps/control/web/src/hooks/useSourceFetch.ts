import { useCallback } from 'react';
import { useI18n } from '../providers/I18nProvider';
import { rpc, rpcJson } from '../lib/rpc';
import { useToast } from './useToast';
import type {
  SourceItem,
  SourceItemInstallation,
  SourceItemTakopack,
} from './useSourceData';
import { PAGE_SIZE } from './useSourcePagination';

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
  const { t } = useI18n();
  const { showToast } = useToast();

  // Fetch installation map from space app deployments
  const fetchInstallations = useCallback(async (): Promise<Map<string, SourceItemInstallation>> => {
    if (!isAuthenticated || !effectiveSpaceId) return new Map();
    try {
      const response = await fetch(`/api/spaces/${effectiveSpaceId}/app-deployments`);
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
  }, [effectiveSpaceId, isAuthenticated]);

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
        if (effectiveSpaceId) queryParams.space_id = effectiveSpaceId;

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
              space: { id: string; name: string };
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
          space: item.repo.space,
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
    [debouncedQuery, sort, category, installableOnly, effectiveSpaceId, fetchInstallations, requestSeqRef, appendInFlightRef, setItems, setLoading, setHasMore, setTotal, setSelectedItem],
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
    if (!effectiveSpaceId) {
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
          param: { spaceId: effectiveSpaceId },
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
  }, [isAuthenticated, effectiveSpaceId, debouncedQuery, fetchInstallations, requestSeqRef, setItems, setLoading, setHasMore, setTotal, setSelectedItem]);

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
    [isAuthenticated, fetchInstallations, requestSeqRef, appendInFlightRef, setItems, setLoading, setHasMore, setTotal, setSelectedItem],
  );

  // Actions

  const install = async (item: SourceItem) => {
    if (!isAuthenticated) {
      onRequireLogin();
      return;
    }
    if (!effectiveSpaceId) {
      showToast('error', t('selectSpaceFirst'));
      return;
    }
    if (!item.takopack?.available) {
      showToast('error', t('noDeployableAppManifest'));
      return;
    }
    try {
      setInstallingId(item.id);
      const response = await fetch(`/api/spaces/${effectiveSpaceId}/app-deployments`, {
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
    if (!effectiveSpaceId || !item.installation?.app_deployment_id) return;
    try {
      const res = await fetch(
        `/api/spaces/${effectiveSpaceId}/app-deployments/${item.installation.app_deployment_id}`,
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
    if (!effectiveSpaceId || !item.installation?.app_deployment_id) return;
    try {
      const res = await fetch(
        `/api/spaces/${effectiveSpaceId}/app-deployments/${item.installation.app_deployment_id}/rollback`,
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

  const createRepo = async (name: string, description: string, visibility: 'public' | 'private'): Promise<boolean> => {
    if (!isAuthenticated) {
      onRequireLogin();
      return false;
    }
    if (!effectiveSpaceId) return false;
    try {
      const response = await rpc.spaces[':spaceId'].repos.$post({
        param: { spaceId: effectiveSpaceId },
        json: { name, description, visibility },
      });
      await rpcJson(response);
      showToast('success', t('repositoryCreated'));
      if (filter === 'mine') {
        void fetchMine(requestSeqRef.current);
      }
      return true;
    } catch {
      showToast('error', t('failedToCreateRepository'));
      return false;
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
    fetchInstallations,
    fetchAll,
    fetchMine,
    fetchStarred,
    install,
    uninstall,
    rollback,
    toggleStar,
    createRepo,
    openRepo,
    getItemTakopack,
  };
}
