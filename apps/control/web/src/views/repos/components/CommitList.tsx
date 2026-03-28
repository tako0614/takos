import { useState, useEffect, useMemo } from 'react';
import { Icons } from '../../../lib/Icons';
import type { Commit } from '../../../types';
import { formatDetailedRelativeDate } from '../../../lib/format';
import { rpc, rpcJson } from '../../../lib/rpc';
import { useI18n } from '../../../store/i18n';

interface CommitListProps {
  repoId: string;
  branch: string;
}

export function CommitList({ repoId, branch }: CommitListProps) {
  const { t } = useI18n();
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setCommits([]);
    setPage(1);
    setHasMore(true);
    fetchCommits(1);
  }, [repoId, branch]);

  const fetchCommits = async (pageNum: number) => {
    try {
      setLoading(true);
      const res = await rpc.repos[':repoId'].commits.$get({
        param: { repoId },
        query: { branch, page: String(pageNum), limit: '20' },
      });
      const data = await rpcJson<{ commits?: Commit[] }>(res);
      const newCommits = data.commits || [];

      if (pageNum === 1) {
        setCommits(newCommits);
      } else {
        setCommits(prev => [...prev, ...newCommits]);
      }

      setHasMore(newCommits.length === 20);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('unknownError'));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchCommits(nextPage);
  };

  const groupCommitsByDate = (commits: Commit[]): Map<string, Commit[]> => {
    const groups = new Map<string, Commit[]>();

    for (const commit of commits) {
      const date = new Date(commit.date);
      const dateKey = date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      if (!groups.has(dateKey)) {
        groups.set(dateKey, []);
      }
      groups.get(dateKey)!.push(commit);
    }

    return groups;
  };

  const copyCommitSha = async (sha: string) => {
    try {
      await navigator.clipboard.writeText(sha);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (loading && commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
        <div className="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
        <span>{t('loadingCommits')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
        <Icons.AlertTriangle className="w-12 h-12 text-zinc-700" />
        <span>{error}</span>
        <button
          className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={() => fetchCommits(1)}
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  const groupedCommits = useMemo(() => groupCommitsByDate(commits), [commits]);

  return (
    <div className="flex flex-col bg-white dark:bg-zinc-900">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
        <Icons.Clock className="w-4 h-4 text-zinc-500" />
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{t('commitsOnBranch', { count: commits.length, branch })}</span>
      </div>

      {commits.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
          <Icons.Clock className="w-12 h-12" />
          <p>{t('noCommitsFound')}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {Array.from(groupedCommits.entries()).map(([dateKey, dateCommits]) => (
            <div key={dateKey} className="flex flex-col">
              <div className="px-4 py-2 text-sm font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                <span>{dateKey}</span>
              </div>
              <div className="flex flex-col">
                {dateCommits.map(commit => (
                  <div key={commit.sha} className="flex items-start gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                    <div className="flex-shrink-0 mt-0.5">
                      {commit.author.avatar_url ? (
                        <img
                          src={commit.author.avatar_url}
                          alt={commit.author.name + "'s avatar"}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {commit.author.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-900 dark:text-zinc-100 font-medium truncate">
                          {commit.message.split('\n')[0]}
                        </span>
                        {commit.message.includes('\n') && (
                          <button
                            className="px-1.5 py-0.5 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                            aria-label={t('showFullCommitMessage')}
                          >
                            ...
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-sm text-zinc-500">
                        <span className="text-zinc-500 dark:text-zinc-400">{commit.author.name}</span>
                        <span>{formatDetailedRelativeDate(commit.date)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        className="flex items-center gap-1.5 px-2 py-1 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                        onClick={() => copyCommitSha(commit.sha)}
                        aria-label={`Copy commit SHA ${commit.sha.slice(0, 7)}`}
                        title={t('copyCommitSha')}
                      >
                        <Icons.Copy className="w-3 h-3" />
                        <span>{commit.sha.slice(0, 7)}</span>
                      </button>
                      {commit.stats && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-zinc-900 dark:text-zinc-100">+{commit.stats.additions}</span>
                          <span className="text-zinc-500">-{commit.stats.deletions}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center py-4">
              <button
                className="flex items-center gap-2 px-6 py-2.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={loadMore}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
                    <span>{t('loading')}</span>
                  </>
                ) : (
                  <span>{t('loadMoreCommits')}</span>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
