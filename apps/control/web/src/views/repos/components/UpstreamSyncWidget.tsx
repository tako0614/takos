import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../../../store/i18n';
import { useToast } from '../../../store/toast';
import { Icons } from '../../../lib/Icons';
import { rpc, rpcJson } from '../../../lib/rpc';
import { Button } from '../../../components/ui/Button';
import type { SyncStatus, SyncResult } from '../../../types';

export interface UpstreamSyncWidgetProps {
  repoId: string;
  onSyncComplete?: () => void;
}

export function UpstreamSyncWidget({
  repoId,
  onSyncComplete,
}: UpstreamSyncWidgetProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSyncStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await rpc.repos[':repoId'].sync.status.$get({
        param: { repoId },
      });
      const data = await rpcJson<SyncStatus>(res);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('syncStatusError'));
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);

    try {
      const res = await rpc.repos[':repoId'].sync.$post({
        param: { repoId },
        json: { strategy: 'fast-forward' },
      });
      const data = await rpcJson<SyncResult>(res);

      if (data.synced) {
        showToast('success', t('syncSuccess', { count: data.new_commits }));
        await fetchSyncStatus();
        onSyncComplete?.();
      } else if (data.conflict) {
        showToast('error', t('syncConflict'));
      } else {
        showToast('info', t('alreadyUpToDate'));
      }
    } catch (err) {
      showToast('error', `${t('syncFailed')}: ${err instanceof Error ? err.message : t('unknownError')}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
        <div className="w-4 h-4 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{t('checkingSyncStatus')}</span>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
        <Icons.AlertTriangle className="w-4 h-4 text-red-500" />
        <span className="text-sm text-red-600 dark:text-red-400">{error || t('syncStatusError')}</span>
        <button
          onClick={fetchSyncStatus}
          className="ml-auto text-sm text-red-600 dark:text-red-400 hover:underline"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  const { commits_behind, commits_ahead, can_sync, can_fast_forward } = status;
  const isUpToDate = commits_behind === 0;
  const hasDiverged = commits_ahead > 0 && commits_behind > 0;

  return (
    <div className="flex flex-col gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icons.GitMerge className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('upstreamSync')}
          </span>
        </div>
        <button
          onClick={fetchSyncStatus}
          disabled={loading || syncing}
          className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={t('refresh')}
        >
          <Icons.RefreshCw className={`w-4 h-4 ${loading || syncing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${
            commits_behind > 0 ? 'bg-yellow-500' : 'bg-green-500'
          }`} />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {commits_behind > 0
              ? t('commitsBehind', { count: commits_behind })
              : t('upToDate')
            }
          </span>
        </div>

        {commits_ahead > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {t('commitsAhead', { count: commits_ahead })}
            </span>
          </div>
        )}
      </div>

      {hasDiverged && !can_fast_forward && (
        <div className="flex items-start gap-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
          <Icons.AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
          <span className="text-xs text-yellow-700 dark:text-yellow-300">
            {t('forkDiverged')}
          </span>
        </div>
      )}

      {can_sync && !isUpToDate && (
        <Button
          variant={can_fast_forward ? 'primary' : 'secondary'}
          size="sm"
          onClick={handleSync}
          isLoading={syncing}
          disabled={syncing}
          leftIcon={<Icons.Download className="w-4 h-4" />}
        >
          {syncing ? t('syncing') : t('syncWithUpstream')}
        </Button>
      )}
    </div>
  );
}
