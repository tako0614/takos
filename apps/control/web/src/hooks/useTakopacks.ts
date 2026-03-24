import { useState, useEffect, useCallback } from 'react';
import { useToast } from './useToast';
import { useI18n } from '../providers/I18nProvider';
import { useConfirmDialog } from '../providers/ConfirmDialogProvider';
import type { Takopack, TakopackDetail } from '../types';

interface UseTakopacksOptions {
  spaceId: string;
}

type AppDeploymentSummary = {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  icon?: string | null;
  deployed_at: string;
  source?: {
    type?: string | null;
    repo_id?: string | null;
    ref?: string | null;
  } | null;
};

type AppDeploymentDetail = AppDeploymentSummary & {
  manifest_json: string;
  groups?: Array<{ id: string; name: string; icon?: string | null }>;
  ui_extensions?: Array<{ id: string; path: string; label?: string | null; icon?: string | null }>;
  mcp_servers?: Array<{ id: string; name: string; transport: string; enabled: boolean }>;
};

function toTakopack(item: AppDeploymentSummary): Takopack {
  return {
    id: item.id,
    name: item.name,
    version: item.version,
    description: item.description || undefined,
    icon: item.icon || undefined,
    installedAt: item.deployed_at,
    sourceType: item.source?.type || null,
    sourceRepoId: item.source?.repo_id || null,
    sourceTag: item.source?.ref || null,
    sourceAssetId: null,
  };
}

function toTakopackDetail(item: AppDeploymentDetail): TakopackDetail {
  return {
    ...toTakopack(item),
    manifestJson: item.manifest_json,
    groups: item.groups || [],
    uiExtensions: (item.ui_extensions || []).map((extension) => ({
      id: extension.id,
      path: extension.path,
      label: extension.label || extension.path,
      icon: extension.icon || undefined,
    })),
    mcpServers: item.mcp_servers || [],
  };
}

export function useTakopacks({ spaceId }: UseTakopacksOptions) {
  const { showToast } = useToast();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();

  const [takopacks, setTakopacks] = useState<Takopack[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTakopack, setSelectedTakopack] = useState<TakopackDetail | null>(null);

  const refresh = useCallback(async () => {
    if (!spaceId) {
      setTakopacks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/app-deployments`);
      if (!res.ok) throw new Error('Failed to fetch app deployments');
      const data = await res.json() as { data?: AppDeploymentSummary[] };
      setTakopacks((data.data || []).map(toTakopack));
    } catch (error) {
      console.error('Failed to load app deployments:', error);
      setTakopacks([]);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getTakopackDetail = useCallback(async (appDeploymentId: string) => {
    try {
      const res = await fetch(`/api/spaces/${spaceId}/app-deployments/${appDeploymentId}`);
      if (!res.ok) throw new Error('Failed to fetch app deployment detail');
      const data = await res.json() as { data?: AppDeploymentDetail };
      const detail = data.data ? toTakopackDetail(data.data) : null;
      setSelectedTakopack(detail);
      return detail;
    } catch (error) {
      console.error('Failed to load app deployment detail:', error);
      showToast('error', t('failedToLoadAppDeployment'));
      return null;
    }
  }, [spaceId, showToast]);

  const uninstall = useCallback(async (appDeploymentId: string, name: string) => {
    const confirmed = await confirm({
      title: t('removeAppDeployment'),
      message: t('removeAppDeploymentConfirm', { name }),
      confirmText: t('remove'),
      cancelText: t('cancel'),
      danger: true,
    });

    if (!confirmed) return false;

    try {
      const res = await fetch(`/api/spaces/${spaceId}/app-deployments/${appDeploymentId}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to remove app deployment');

      showToast('success', t('appDeploymentRemoved'));
      setSelectedTakopack(null);
      await refresh();
      return true;
    } catch (error) {
      showToast('error', t('failedToRemoveAppDeployment'));
      return false;
    }
  }, [spaceId, confirm, refresh, showToast]);

  const rollback = useCallback(async (appDeploymentId: string, name: string) => {
    const confirmed = await confirm({
      title: t('rollbackAppDeployment'),
      message: t('rollbackAppDeploymentConfirm', { name }),
      confirmText: t('rollback'),
      cancelText: t('cancel'),
      danger: true,
    });

    if (!confirmed) return null;

    try {
      const res = await fetch(`/api/spaces/${spaceId}/app-deployments/${appDeploymentId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      if (!res.ok) {
        const error = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error || 'Rollback failed');
      }

      const data = await res.json() as {
        data?: {
          app_deployment_id?: string;
          previous_version?: string;
          target_version?: string;
        };
      };
      showToast('success', t('rolledBackName', { name }));
      await refresh();

      const newId = data.data?.app_deployment_id;
      if (newId) {
        await getTakopackDetail(newId);
      } else {
        setSelectedTakopack(null);
      }

      return data.data || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : t('rollbackFailed');
      showToast('error', message);
      return null;
    }
  }, [spaceId, confirm, refresh, showToast, getTakopackDetail]);

  return {
    takopacks,
    loading,
    selectedTakopack,
    setSelectedTakopack,
    refresh,
    getTakopackDetail,
    uninstall,
    rollback,
  };
}
