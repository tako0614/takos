import { useCallback, useEffect, useState } from 'react';
import { rpc, rpcJson } from '../lib/rpc';
import { useConfirmDialog } from '../providers/ConfirmDialogProvider';
import { useI18n } from '../providers/I18nProvider';
import { useToast } from './useToast';
import type { Resource } from '../types';

function isYurucommuResource(resource: Resource): boolean {
  if (!resource.metadata) return false;
  try {
    const metadata = JSON.parse(resource.metadata) as { source?: string };
    return metadata?.source === 'yurucommu';
  } catch {
    return false;
  }
}

export function useSpaceResources(spaceId: string | null) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [resources, setResources] = useState<Resource[]>([]);
  const [loadingResources, setLoadingResources] = useState(true);
  const [showCreateResourceModal, setShowCreateResourceModal] = useState(false);
  const [newResourceName, setNewResourceName] = useState('');
  const [newResourceType, setNewResourceType] = useState<Resource['type']>('d1');
  const [creatingResource, setCreatingResource] = useState(false);

  const refreshResources = useCallback(async () => {
    setLoadingResources(true);
    try {
      const res = await rpc.resources.$get({
        query: spaceId ? { space_id: spaceId } : {},
      });
      const data = await rpcJson<{ resources?: Resource[]; owned?: Resource[]; shared?: Resource[] }>(res);
      if (data.resources) {
        setResources(data.resources);
      } else {
        setResources([...(data.owned || []), ...(data.shared || [])]);
      }
    } catch {
      setResources([]);
    } finally {
      setLoadingResources(false);
    }
  }, [spaceId]);

  useEffect(() => {
    refreshResources();
  }, [refreshResources]);

  const createResource = useCallback(async () => {
    if (!newResourceName.trim()) return false;
    setCreatingResource(true);
    try {
      const res = await rpc.resources.$post({
        json: {
          name: newResourceName.trim(),
          type: newResourceType,
          space_id: spaceId || undefined,
        },
      });
      await rpcJson(res);
      setShowCreateResourceModal(false);
      setNewResourceName('');
      showToast('success', t('created'));
      await refreshResources();
      return true;
    } catch {
      showToast('error', t('failedToCreate'));
      return false;
    } finally {
      setCreatingResource(false);
    }
  }, [newResourceName, newResourceType, refreshResources, showToast, t, spaceId]);

  const deleteResource = useCallback(async (resource: Resource) => {
    const baseMessage = t('confirmDeleteResource');
    const warning = isYurucommuResource(resource)
      ? `${baseMessage}\n\nWarning: This resource is linked to Yurucommu. Deleting it may break your Yurucommu instance.`
      : baseMessage;
    const confirmed = await confirm({
      title: t('deleteResource'),
      message: warning,
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return false;
    try {
      const res = await rpc.resources['by-name'][':name'].$delete({ param: { name: resource.name } });
      await rpcJson(res);
      showToast('success', t('deleted'));
      await refreshResources();
      return true;
    } catch {
      showToast('error', t('failedToDelete'));
      return false;
    }
  }, [confirm, refreshResources, showToast, t]);

  return {
    resources,
    loadingResources,
    refreshResources,
    showCreateResourceModal,
    setShowCreateResourceModal,
    newResourceName,
    setNewResourceName,
    newResourceType,
    setNewResourceType,
    creatingResource,
    createResource,
    deleteResource,
  };
}
