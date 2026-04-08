import type { Accessor, Setter } from 'solid-js';
import { useI18n } from '../store/i18n.ts';
import { rpc, rpcJson } from '../lib/rpc.ts';
import { useToast } from '../store/toast.ts';
import type {
  SourceItem,
  SourceItemInstallation,
  SourceItemTakopack,
} from './useSourceData.ts';

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

export interface UseSourceFetchActionsOptions {
  isAuthenticated: Accessor<boolean>;
  effectiveSpaceId: Accessor<string | null>;
  filter: Accessor<string>;
  onNavigateToRepo: (username: string, repoName: string) => void;
  onRequireLogin: () => void;
  setItems: Setter<SourceItem[]>;
  setSelectedItem: Setter<SourceItem | null>;
  setInstallingId: Setter<string | null>;
  refs: { requestSeqRef: number; appendInFlightRef: boolean };
  fetchMine: (requestId?: number) => Promise<void>;
}

export interface UseSourceFetchActionsResult {
  install: (item: SourceItem) => Promise<void>;
  uninstall: (item: SourceItem) => Promise<void>;
  rollback: (item: SourceItem) => Promise<void>;
  toggleStar: (item: SourceItem) => Promise<void>;
  createRepo: (name: string, description: string, visibility: 'public' | 'private') => Promise<boolean>;
  openRepo: (item: SourceItem) => void;
  getItemTakopack: (item: SourceItem) => SourceItemTakopack;
}

export function useSourceFetchActions({
  isAuthenticated,
  effectiveSpaceId,
  filter,
  onNavigateToRepo,
  onRequireLogin,
  setItems,
  setSelectedItem,
  setInstallingId,
  refs,
  fetchMine,
}: UseSourceFetchActionsOptions): UseSourceFetchActionsResult {
  const { t } = useI18n();
  const { showToast } = useToast();

  const install = async (item: SourceItem) => {
    if (!isAuthenticated()) {
      onRequireLogin();
      return;
    }
    if (!effectiveSpaceId()) {
      showToast('error', t('selectSpaceFirst'));
      return;
    }
    if (!item.takopack?.available) {
      showToast('error', t('noDeployableAppManifest'));
      return;
    }
    try {
      setInstallingId(item.id);
      // Backend (packages/control/src/server/routes/app-deployments.ts) expects
      // a discriminated `source` object with a canonical Takos repository URL.
      const repositoryUrl = `${globalThis.location.origin}/git/${item.owner.username}/${item.name}.git`;
      const response = await fetch(`/api/spaces/${effectiveSpaceId()}/app-deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: {
            kind: 'git_ref',
            repository_url: repositoryUrl,
            ref: item.default_branch || 'main',
            ref_type: 'branch',
          },
        }),
      });
      const data = await rpcJson<{ app_deployment?: { id?: string } }>(response);
      showToast('success', t('deployedItem', { name: item.name }));

      const installation: SourceItemInstallation = {
        installed: true,
        app_deployment_id: data.app_deployment?.id ?? null,
        installed_version: item.takopack.latest_version,
        deployed_at: new Date().toISOString(),
      };
      const updateItem = (i: SourceItem) => (i.id === item.id ? { ...i, installation } : i);
      setItems((prev) => prev.map(updateItem));
      setSelectedItem((prev) => (prev?.id === item.id ? updateItem(prev) : prev));
    } catch (err) {
      showToast('error', err instanceof Error && err.message ? err.message : t('installFailed'));
    } finally {
      setInstallingId(null);
    }
  };

  const uninstall = async (item: SourceItem) => {
    if (!isAuthenticated()) {
      onRequireLogin();
      return;
    }
    if (!effectiveSpaceId() || !item.installation?.app_deployment_id) return;
    try {
      // Use rpcJson so we pick up 401 auto-redirect, OAuth/envelope error
      // message parsing, and consistent error shapes.
      const response = await fetch(
        `/api/spaces/${effectiveSpaceId()}/app-deployments/${item.installation.app_deployment_id}`,
        { method: 'DELETE' },
      );
      await rpcJson(response);
      showToast('success', t('uninstalledItem', { name: item.name }));
      const updateItem = (i: SourceItem) =>
        i.id === item.id ? { ...i, installation: undefined } : i;
      setItems((prev) => prev.map(updateItem));
      setSelectedItem((prev) => (prev?.id === item.id ? { ...prev, installation: undefined } : prev));
    } catch (err) {
      showToast('error', err instanceof Error && err.message ? err.message : t('uninstallFailed'));
    }
  };

  const rollback = async (item: SourceItem) => {
    if (!isAuthenticated()) {
      onRequireLogin();
      return;
    }
    if (!effectiveSpaceId() || !item.installation?.app_deployment_id) return;
    try {
      // Use rpcJson so we pick up 401 auto-redirect, OAuth/envelope error
      // message parsing, and consistent error shapes.
      const response = await fetch(
        `/api/spaces/${effectiveSpaceId()}/app-deployments/${item.installation.app_deployment_id}/rollback`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      await rpcJson(response);
      showToast('success', t('rolledBackItem', { name: item.name }));
    } catch (err) {
      showToast('error', err instanceof Error && err.message ? err.message : t('rollbackFailed'));
    }
  };

  const toggleStar = async (item: SourceItem) => {
    if (!isAuthenticated()) {
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
        if (filter() === 'starred' && item.is_starred) {
          return updated.filter((i) => i.id !== item.id);
        }
        return updated;
      });
      setSelectedItem((prev) => {
        if (prev?.id !== item.id) return prev;
        if (filter() === 'starred' && item.is_starred) {
          return null;
        }
        return updateItem(prev);
      });
    } catch {
      showToast('error', t('failedToUpdateStar'));
    }
  };

  const createRepo = async (name: string, description: string, visibility: 'public' | 'private'): Promise<boolean> => {
    if (!isAuthenticated()) {
      onRequireLogin();
      return false;
    }
    if (!effectiveSpaceId()) return false;
    try {
      const response = await rpc.spaces[':spaceId'].repos.$post({
        param: { spaceId: effectiveSpaceId()! },
        json: { name, description, visibility },
      });
      await rpcJson(response);
      showToast('success', t('repositoryCreated'));
      if (filter() === 'mine') {
        void fetchMine(refs.requestSeqRef);
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
    install,
    uninstall,
    rollback,
    toggleStar,
    createRepo,
    openRepo,
    getItemTakopack,
  };
}
