import { createSignal, onMount } from 'solid-js';
import { rpc, rpcJson, rpcPath } from '../lib/rpc.ts';
import { useConfirmDialog } from '../store/confirm-dialog.ts';
import { useI18n } from '../store/i18n.ts';
import { useToast } from '../store/toast.ts';
import type { Worker } from '../types/index.ts';

function isYurucommuWorker(worker: Worker): boolean {
  if (!worker.config) return false;
  try {
    const config = JSON.parse(worker.config) as { source?: string };
    return config?.source === 'yurucommu';
  } catch {
    return false;
  }
}

export function useSpaceWorkers(spaceId: string | null) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [cfWorkers, setCfWorkers] = createSignal<Worker[]>([]);
  const [loadingCfWorkers, setLoadingCfWorkers] = createSignal(true);

  const refreshWorkers = async () => {
    setLoadingCfWorkers(true);
    try {
      const res = spaceId
        ? await fetch(`/api/workers/space/${encodeURIComponent(spaceId)}`)
        : await rpcPath(rpc, 'workers').$get({ param: {} }) as Response;
      // Backend returns `{ services }` (see packages/control/src/server/routes/workers/routes.ts).
      const data = await rpcJson<{ services: Worker[] }>(res);
      setCfWorkers(data.services || []);
    } catch {
      setCfWorkers([]);
    } finally {
      setLoadingCfWorkers(false);
    }
  };

  onMount(() => {
    refreshWorkers();
  });

  const deleteWorker = async (worker: Worker) => {
    const baseMessage = t('confirmDeleteWorker');
    const warning = isYurucommuWorker(worker)
      ? `${baseMessage}\n\nWarning: This worker is linked to Yurucommu. Deleting it may break your Yurucommu instance.`
      : baseMessage;
    const confirmed = await confirm({
      title: t('deleteWorker'),
      message: warning,
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return false;
    try {
      const res = await rpcPath(rpc, 'workers', ':id').$delete({ param: { id: worker.id } }) as Response;
      await rpcJson(res);
      showToast('success', t('deleted'));
      await refreshWorkers();
      return true;
    } catch {
      showToast('error', t('failedToDelete'));
      return false;
    }
  };

  return {
    cfWorkers,
    setCfWorkers,
    loadingCfWorkers,
    refreshWorkers,
    deleteWorker,
  };
}
