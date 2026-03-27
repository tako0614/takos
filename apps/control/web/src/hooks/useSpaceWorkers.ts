import { useCallback, useEffect, useState } from 'react';
import { rpc, rpcJson } from '../lib/rpc';
import { useConfirmDialog } from '../providers/ConfirmDialogProvider';
import { useI18n } from '../providers/I18nProvider';
import { useToast } from './useToast';
import type { Worker } from '../types';

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

  const [cfWorkers, setCfWorkers] = useState<Worker[]>([]);
  const [loadingCfWorkers, setLoadingCfWorkers] = useState(true);

  const refreshWorkers = useCallback(async () => {
    setLoadingCfWorkers(true);
    try {
      const res = spaceId
        ? await fetch(`/api/workers/space/${encodeURIComponent(spaceId)}`)
        : await rpc.workers.$get();
      const data = await rpcJson<{ workers: Worker[] }>(res);
      setCfWorkers(data.workers || []);
    } catch {
      setCfWorkers([]);
    } finally {
      setLoadingCfWorkers(false);
    }
  }, [spaceId]);

  useEffect(() => {
    refreshWorkers();
  }, [refreshWorkers]);

  const deleteWorker = useCallback(async (worker: Worker) => {
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
      const res = await rpc.workers[':id'].$delete({ param: { id: worker.id } });
      await rpcJson(res);
      showToast('success', t('deleted'));
      await refreshWorkers();
      return true;
    } catch {
      showToast('error', t('failedToDelete'));
      return false;
    }
  }, [confirm, refreshWorkers, showToast, t]);

  return {
    cfWorkers,
    setCfWorkers,
    loadingCfWorkers,
    refreshWorkers,
    deleteWorker,
  };
}
