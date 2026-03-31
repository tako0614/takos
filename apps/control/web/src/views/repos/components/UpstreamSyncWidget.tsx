import { createSignal, createEffect, on, Show } from 'solid-js';
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

export function UpstreamSyncWidget(props: UpstreamSyncWidgetProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [status, setStatus] = createSignal<SyncStatus | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [syncing, setSyncing] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const fetchSyncStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await rpc.repos[':repoId'].sync.status.$get({
        param: { repoId: props.repoId },
      });
      const data = await rpcJson<SyncStatus>(res);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('syncStatusError'));
    } finally {
      setLoading(false);
    }
  };

  createEffect(on(() => props.repoId, () => {
    fetchSyncStatus();
  }));

  const handleSync = async () => {
    if (syncing()) return;
    setSyncing(true);

    try {
      const res = await rpc.repos[':repoId'].sync.$post({
        param: { repoId: props.repoId },
        json: { strategy: 'fast-forward' },
      });
      const data = await rpcJson<SyncResult>(res);

      if (data.synced) {
        showToast('success', t('syncSuccess', { count: data.new_commits }));
        await fetchSyncStatus();
        props.onSyncComplete?.();
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

  return (
    <>
      <Show when={loading()}>
        <div class="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div class="w-4 h-4 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
          <span class="text-sm text-zinc-500 dark:text-zinc-400">{t('checkingSyncStatus')}</span>
        </div>
      </Show>

      <Show when={!loading() && (error() || !status())}>
        <div class="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <Icons.AlertTriangle class="w-4 h-4 text-red-500" />
          <span class="text-sm text-red-600 dark:text-red-400">{error() || t('syncStatusError')}</span>
          <button
            onClick={fetchSyncStatus}
            class="ml-auto text-sm text-red-600 dark:text-red-400 hover:underline"
          >
            {t('retry')}
          </button>
        </div>
      </Show>

      <Show when={!loading() && !error() && status()}>
        {(s) => {
          const commits_behind = () => s().commits_behind;
          const commits_ahead = () => s().commits_ahead;
          const can_sync = () => s().can_sync;
          const can_fast_forward = () => s().can_fast_forward;
          const isUpToDate = () => commits_behind() === 0;
          const hasDiverged = () => commits_ahead() > 0 && commits_behind() > 0;

          return (
            <div class="flex flex-col gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <Icons.GitMerge class="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                  <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {t('upstreamSync')}
                  </span>
                </div>
                <button
                  onClick={fetchSyncStatus}
                  disabled={loading() || syncing()}
                  class="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={t('refresh')}
                >
                  <Icons.RefreshCw class={`w-4 h-4 ${loading() || syncing() ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div class="flex items-center gap-4">
                <div class="flex items-center gap-1.5">
                  <div class={`w-2 h-2 rounded-full ${
                    commits_behind() > 0 ? 'bg-yellow-500' : 'bg-green-500'
                  }`} />
                  <span class="text-sm text-zinc-600 dark:text-zinc-400">
                    {commits_behind() > 0
                      ? t('commitsBehind', { count: commits_behind() })
                      : t('upToDate')
                    }
                  </span>
                </div>

                <Show when={commits_ahead() > 0}>
                  <div class="flex items-center gap-1.5">
                    <div class="w-2 h-2 rounded-full bg-blue-500" />
                    <span class="text-sm text-zinc-600 dark:text-zinc-400">
                      {t('commitsAhead', { count: commits_ahead() })}
                    </span>
                  </div>
                </Show>
              </div>

              <Show when={hasDiverged() && !can_fast_forward()}>
                <div class="flex items-start gap-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
                  <Icons.AlertTriangle class="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                  <span class="text-xs text-yellow-700 dark:text-yellow-300">
                    {t('forkDiverged')}
                  </span>
                </div>
              </Show>

              <Show when={can_sync() && !isUpToDate()}>
                <Button
                  variant={can_fast_forward() ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={handleSync}
                  isLoading={syncing()}
                  disabled={syncing()}
                  leftIcon={<Icons.Download class="w-4 h-4" />}
                >
                  {syncing() ? t('syncing') : t('syncWithUpstream')}
                </Button>
              </Show>
            </div>
          );
        }}
      </Show>
    </>
  );
}
