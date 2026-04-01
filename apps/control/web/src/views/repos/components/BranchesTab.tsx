import { createSignal, createEffect, on, Show, For } from 'solid-js';
import { Icons } from '../../../lib/Icons.tsx';
import type { Branch } from '../../../types/index.ts';
import { useToast } from '../../../store/toast.ts';
import { useConfirmDialog } from '../../../store/confirm-dialog.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { rpc, rpcJson } from '../../../lib/rpc.ts';
import { useI18n } from '../../../store/i18n.ts';
import { formatDetailedRelativeDate } from '../../../lib/format.ts';

interface BranchWithCommit extends Branch {
  latest_commit?: {
    sha: string;
    message: string;
    author_name: string;
    date: string;
  };
}

interface BranchesTabProps {
  repoId: string;
}

export function BranchesTab(props: BranchesTabProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [branches, setBranches] = createSignal<BranchWithCommit[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);

  const fetchBranches = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await rpc.repos[':repoId'].branches.$get({
        param: { repoId: props.repoId },
        query: { include_commits: 'true' },
      });
      const data = await rpcJson<{ branches?: BranchWithCommit[] }>(res);
      setBranches(data.branches || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  createEffect(on(() => props.repoId, () => {
    fetchBranches();
  }));

  const handleSetDefault = async (branchName: string) => {
    const confirmed = await confirm({
      title: t('branchSetDefaultTitle'),
      message: t('branchSetDefaultMessage').replace('{branch}', branchName),
      confirmText: t('confirm'),
    });
    if (!confirmed) return;

    setActionLoading(branchName);
    try {
      const res = await rpc.repos[':repoId'].branches[':branchName'].default.$post({
        param: { repoId: props.repoId, branchName },
      });
      await rpcJson(res);
      showToast('success', t('branchSetDefaultSuccess'));
      fetchBranches();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('operationFailed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (branchName: string) => {
    const confirmed = await confirm({
      title: t('branchDeleteTitle'),
      message: t('branchDeleteMessage').replace('{branch}', branchName),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;

    setActionLoading(branchName);
    try {
      const res = await rpc.repos[':repoId'].branches[':branchName'].$delete({
        param: { repoId: props.repoId, branchName },
      });
      await rpcJson(res);
      showToast('success', t('branchDeleteSuccess'));
      fetchBranches();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('operationFailed'));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <>
      <Show when={loading()}>
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
          <div class="w-8 h-8 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
          <span>{t('loading')}</span>
        </div>
      </Show>

      <Show when={!loading() && error()}>
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
          <Icons.AlertTriangle class="w-12 h-12 text-zinc-700" />
          <span class="text-zinc-700">{error()}</span>
          <Button variant="secondary" size="sm" onClick={fetchBranches}>
            {t('retry')}
          </Button>
        </div>
      </Show>

      <Show when={!loading() && !error()}>
        <div class="flex flex-col" style={{ "background-color": 'var(--color-surface-primary)' }}>
          <div
            class="flex items-center justify-between px-4 py-3 border-b"
            style={{
              "border-color": 'var(--color-border-primary)',
              "background-color": 'var(--color-bg-secondary)',
            }}
          >
            <div class="flex items-center gap-2">
              <Icons.GitMerge class="w-4 h-4 text-zinc-500" />
              <span class="text-sm text-zinc-500">
                {branches().length} {t('branches')}
              </span>
            </div>
          </div>

          <Show when={branches().length === 0}>
            <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
              <Icons.GitMerge class="w-12 h-12 text-zinc-400" />
              <p class="text-zinc-700">{t('noBranches')}</p>
            </div>
          </Show>

          <Show when={branches().length > 0}>
            <div class="flex flex-col">
              <For each={branches()}>{(branch) => (
                <div
                  class="flex items-center gap-4 px-4 py-4 border-b hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  style={{ "border-color": 'var(--color-border-primary)' }}
                >
                  <div class="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                    <Icons.GitMerge class="w-5 h-5" />
                  </div>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                        {branch.name}
                      </h3>
                      <Show when={branch.is_default}>
                        <Badge
                          variant="default"
                          size="sm"
                          style={{
                            "background-color": 'var(--color-primary)',
                            color: 'white',
                          }}
                        >
                          {t('branchDefault')}
                        </Badge>
                      </Show>
                      <Show when={branch.is_protected}>
                        <Badge
                          variant="default"
                          size="sm"
                          style={{
                            "background-color": 'var(--color-bg-tertiary)',
                            color: 'var(--color-text-secondary)',
                            border: '1px solid var(--color-border-secondary)',
                          }}
                        >
                          <Icons.Eye class="w-3 h-3 mr-1" />
                          {t('branchProtected')}
                        </Badge>
                      </Show>
                    </div>

                    <Show when={branch.latest_commit}>
                      <div class="flex items-center gap-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        <span class="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs border border-zinc-200 dark:border-zinc-700">
                          {branch.commit_sha.slice(0, 7)}
                        </span>
                        <span class="truncate max-w-xs">
                          {branch.latest_commit!.message.split('\n')[0]}
                        </span>
                        <span class="flex-shrink-0">
                          {formatDetailedRelativeDate(branch.latest_commit!.date)}
                        </span>
                      </div>
                    </Show>
                  </div>

                  <div class="flex items-center gap-2 flex-shrink-0">
                    <Show when={!branch.is_default}>
                      <button type="button"
                        class="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                        onClick={() => handleSetDefault(branch.name)}
                        disabled={actionLoading() === branch.name}
                        title={t('branchSetDefault')}
                      >
                        <Show when={actionLoading() === branch.name} fallback={
                          <Icons.Star class="w-4 h-4" />
                        }>
                          <div class="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                        </Show>
                      </button>
                    </Show>
                    <Show when={!branch.is_default && !branch.is_protected}>
                      <button type="button"
                        class="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                        onClick={() => handleDelete(branch.name)}
                        disabled={actionLoading() === branch.name}
                        title={t('branchDelete')}
                      >
                        <Show when={actionLoading() === branch.name} fallback={
                          <Icons.Trash class="w-4 h-4" />
                        }>
                          <div class="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                        </Show>
                      </button>
                    </Show>
                  </div>
                </div>
              )}</For>
            </div>
          </Show>
        </div>
      </Show>
    </>
  );
}
