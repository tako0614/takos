import { createSignal, createEffect, on, Show, For } from 'solid-js';
import { Icons } from '../../../lib/Icons';
import type { PullRequest } from '../../../types';
import { PRDetail } from './PRDetail';
import { formatDetailedRelativeDate } from '../../../lib/format';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { rpc, rpcJson } from '../../../lib/rpc';
import { useI18n } from '../../../store/i18n';

type PRStatus = 'open' | 'merged' | 'closed' | 'all';

interface PRListProps {
  repoId: string;
}

export function PRList(props: PRListProps) {
  const { t } = useI18n();
  const [prs, setPrs] = createSignal<PullRequest[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [statusFilter, setStatusFilter] = createSignal<PRStatus>('open');
  const [selectedPR, setSelectedPR] = createSignal<PullRequest | null>(null);

  const fetchPRs = async () => {
    try {
      setLoading(true);
      const res = await rpc.repos[':repoId'].pulls.$get({
        param: { repoId: props.repoId },
        query: statusFilter() !== 'all' ? { status: statusFilter() } : {},
      });
      const data = await rpcJson<{ pull_requests?: PullRequest[] }>(res);
      setPrs(data.pull_requests || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setLoading(false);
    }
  };

  createEffect(on(
    () => [props.repoId, statusFilter()],
    () => { fetchPRs(); },
  ));

  const getStatusIcon = (status: PullRequest['status']) => {
    switch (status) {
      case 'open':
        return <Icons.GitMerge />;
      case 'merged':
        return <Icons.Check />;
      case 'closed':
        return <Icons.X />;
    }
  };

  const getStatusIconClasses = (status: PullRequest['status']) => {
    switch (status) {
      case 'open':
        return 'text-zinc-900 dark:text-zinc-100';
      case 'merged':
        return 'text-zinc-700 dark:text-zinc-300';
      case 'closed':
        return 'text-zinc-400';
    }
  };

  const formatStatusTimestamp = (pr: PullRequest): string => {
    if (pr.status === 'merged' && pr.merged_at) {
      return t('prMergedAt', { date: formatDetailedRelativeDate(pr.merged_at) });
    }
    if (pr.status === 'closed' && pr.closed_at) {
      return t('prClosedAt', { date: formatDetailedRelativeDate(pr.closed_at) });
    }
    return t('prOpenedAt', { date: formatDetailedRelativeDate(pr.created_at) });
  };

  const filteredPRs = () => statusFilter() === 'all'
    ? prs()
    : prs().filter(pr => pr.status === statusFilter());

  const statusCounts = () => ({
    open: prs().filter(pr => pr.status === 'open').length,
    merged: prs().filter(pr => pr.status === 'merged').length,
    closed: prs().filter(pr => pr.status === 'closed').length,
    all: prs().length,
  });

  return (
    <>
      <Show when={selectedPR()}>
        {(pr) => (
          <PRDetail
            repoId={props.repoId}
            pr={pr()}
            onBack={() => setSelectedPR(null)}
            onUpdate={(updatedPR) => {
              setPrs(prs().map(p => p.id === updatedPR.id ? updatedPR : p));
              setSelectedPR(updatedPR);
            }}
          />
        )}
      </Show>

      <Show when={!selectedPR()}>
        <Show when={loading()}>
          <div class="flex flex-col items-center justify-center py-16 text-zinc-500">
            <div class="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
            <span class="mt-3">{t('loadingPullRequests')}</span>
          </div>
        </Show>

        <Show when={!loading() && error()}>
          <div class="flex flex-col items-center justify-center py-16 text-zinc-500">
            <Icons.AlertTriangle class="w-8 h-8 text-zinc-700" />
            <span class="mt-3 text-zinc-700">{error()}</span>
            <Button
              variant="secondary"
              size="sm"
              class="mt-4"
              onClick={fetchPRs}
            >
              {t('retry')}
            </Button>
          </div>
        </Show>

        <Show when={!loading() && !error()}>
          <div class="flex flex-col h-full" style={{ "background-color": 'var(--color-bg-secondary)' }}>
            <div class="flex items-center justify-between px-6 py-4 border-b" style={{ "border-color": 'var(--color-border-primary)', "background-color": 'var(--color-surface-primary)' }}>
              <div class="flex items-center gap-2">
                <button
                  class={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    statusFilter() === 'open'
                      ? 'bg-zinc-900 text-white'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                  onClick={() => setStatusFilter('open')}
                >
                  <Icons.GitMerge class="w-4 h-4" />
                  <span>{statusCounts().open} {t('prStatusOpen')}</span>
                </button>
                <button
                  class={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    statusFilter() === 'merged'
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                  onClick={() => setStatusFilter('merged')}
                >
                  <Icons.Check class="w-4 h-4" />
                  <span>{statusCounts().merged} {t('prStatusMerged')}</span>
                </button>
                <button
                  class={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    statusFilter() === 'closed'
                      ? 'bg-zinc-400 text-white'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                  onClick={() => setStatusFilter('closed')}
                >
                  <Icons.X class="w-4 h-4" />
                  <span>{statusCounts().closed} {t('prStatusClosed')}</span>
                </button>
              </div>

              <Button
                variant="primary"
                size="sm"
                leftIcon={<Icons.Plus class="w-4 h-4" />}
              >
                {t('newPullRequest')}
              </Button>
            </div>

            <Show when={filteredPRs().length === 0}>
              <div class="flex flex-col items-center justify-center py-16 text-zinc-500">
                <Icons.GitMerge class="w-12 h-12 mb-4 text-zinc-400" />
                <p class="text-lg font-medium text-zinc-900 dark:text-zinc-100">{t('noPullRequestsFound')}</p>
                <span class="mt-1">
                  {statusFilter() !== 'all'
                    ? t('noStatusPullRequests', { status: t(`prStatus${statusFilter().charAt(0).toUpperCase() + statusFilter().slice(1)}` as 'prStatusOpen' | 'prStatusMerged' | 'prStatusClosed') })
                    : t('createFirstPullRequest')}
                </span>
              </div>
            </Show>

            <Show when={filteredPRs().length > 0}>
              <div class="flex-1 overflow-auto">
                <For each={filteredPRs()}>{(pr) => (
                  <div
                    class="flex items-start gap-4 px-6 py-4 border-b hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
                    style={{ "border-color": 'var(--color-border-primary)' }}
                    onClick={() => setSelectedPR(pr)}
                  >
                    <div class={`mt-1 ${getStatusIconClasses(pr.status)}`}>
                      {getStatusIcon(pr.status)}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-zinc-500 text-sm">#{pr.number}</span>
                        <span class="font-medium text-zinc-900 dark:text-zinc-100 hover:text-zinc-700 dark:hover:text-zinc-300">{pr.title}</span>
                        <Show when={!pr.is_mergeable && pr.status === 'open'}>
                          <Badge variant="default" size="sm" style={{ "background-color": 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}>
                            <Icons.AlertTriangle class="w-3 h-3 mr-1" />
                            {t('conflicts')}
                          </Badge>
                        </Show>
                      </div>
                      <div class="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                        <span class="flex items-center gap-1">
                          <Show when={pr.author.avatar_url}>
                            <img src={pr.author.avatar_url} alt={pr.author.name} class="w-4 h-4 rounded-full" />
                          </Show>
                          {pr.author.name}
                        </span>
                        <span class="flex items-center gap-1">
                          <code class="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">{pr.source_branch}</code>
                          <Icons.ChevronRight class="w-3 h-3" />
                          <code class="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">{pr.target_branch}</code>
                        </span>
                        <span>{formatStatusTimestamp(pr)}</span>
                      </div>
                    </div>
                    <div class="flex items-center gap-4 text-zinc-500">
                      <span class="flex items-center gap-1 text-xs" title={t('comment')}>
                        <Icons.MessageSquare class="w-4 h-4" />
                        {pr.comments_count}
                      </span>
                      <span class="flex items-center gap-1 text-xs" title={t('commits')}>
                        <Icons.Clock class="w-4 h-4" />
                        {pr.commits_count}
                      </span>
                    </div>
                  </div>
                )}</For>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </>
  );
}
