import { createSignal, onMount } from 'solid-js';
import { rpc, rpcJson, rpcPath } from '../lib/rpc';
import { useConfirmDialog } from '../store/confirm-dialog';
import { useI18n } from '../store/i18n';
import { useToast } from '../store/toast';
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

  const [resources, setResources] = createSignal<Resource[]>([]);
  const [loadingResources, setLoadingResources] = createSignal(true);
  const [showCreateResourceModal, setShowCreateResourceModal] = createSignal(false);
  const [newResourceName, setNewResourceName] = createSignal('');
  const [newResourceType, setNewResourceType] = createSignal<Resource['type']>('d1');
  const [creatingResource, setCreatingResource] = createSignal(false);

  const refreshResources = async () => {
    setLoadingResources(true);
    try {
      const res = await rpcPath(rpc, 'resources').$get({
        param: {},
        query: spaceId ? { space_id: spaceId } : {},
      }) as Response;
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
  };

  onMount(() => {
    refreshResources();
  });

  const createResource = async () => {
    if (!newResourceName().trim()) return false;
    setCreatingResource(true);
    try {
      const res = await rpcPath(rpc, 'resources').$post({
        param: {},
        json: {
          name: newResourceName().trim(),
          type: newResourceType(),
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
  };

  const deleteResource = async (resource: Resource) => {
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
      const res = await rpcPath(rpc, 'resources', 'by-name', ':name').$delete({ param: { name: resource.name } }) as Response;
      await rpcJson(res);
      showToast('success', t('deleted'));
      await refreshResources();
      return true;
    } catch {
      showToast('error', t('failedToDelete'));
      return false;
    }
  };

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
