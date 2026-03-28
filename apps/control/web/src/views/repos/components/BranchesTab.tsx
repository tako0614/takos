import { useState, useEffect, useCallback } from 'react';
import { Icons } from '../../../lib/Icons';
import type { Branch } from '../../../types';
import { useToast } from '../../../store/toast';
import { useConfirmDialog } from '../../../store/confirm-dialog';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { rpc, rpcJson } from '../../../lib/rpc';
import { useI18n } from '../../../store/i18n';
import { formatDetailedRelativeDate } from '../../../lib/format';

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

export function BranchesTab({ repoId }: BranchesTabProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [branches, setBranches] = useState<BranchWithCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchBranches = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await rpc.repos[':repoId'].branches.$get({
        param: { repoId },
        query: { include_commits: 'true' },
      });
      const data = await rpcJson<{ branches?: BranchWithCommit[] }>(res);
      setBranches(data.branches || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [repoId, t]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches, repoId]);

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
        param: { repoId, branchName },
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
        param: { repoId, branchName },
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
        <div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
        <span>{t('loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
        <Icons.AlertTriangle className="w-12 h-12 text-zinc-700" />
        <span className="text-zinc-700">{error}</span>
        <Button variant="secondary" size="sm" onClick={fetchBranches}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ backgroundColor: 'var(--color-surface-primary)' }}>
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{
          borderColor: 'var(--color-border-primary)',
          backgroundColor: 'var(--color-bg-secondary)',
        }}
      >
        <div className="flex items-center gap-2">
          <Icons.GitMerge className="w-4 h-4 text-zinc-500" />
          <span className="text-sm text-zinc-500">
            {branches.length} {t('branches')}
          </span>
        </div>
      </div>

      {branches.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
          <Icons.GitMerge className="w-12 h-12 text-zinc-400" />
          <p className="text-zinc-700">{t('noBranches')}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {branches.map((branch) => (
            <div
              key={branch.name}
              className="flex items-center gap-4 px-4 py-4 border-b hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              style={{ borderColor: 'var(--color-border-primary)' }}
            >
              <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                <Icons.GitMerge className="w-5 h-5" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {branch.name}
                  </h3>
                  {branch.is_default && (
                    <Badge
                      variant="default"
                      size="sm"
                      style={{
                        backgroundColor: 'var(--color-primary)',
                        color: 'white',
                      }}
                    >
                      {t('branchDefault')}
                    </Badge>
                  )}
                  {branch.is_protected && (
                    <Badge
                      variant="default"
                      size="sm"
                      style={{
                        backgroundColor: 'var(--color-bg-tertiary)',
                        color: 'var(--color-text-secondary)',
                        border: '1px solid var(--color-border-secondary)',
                      }}
                    >
                      <Icons.Eye className="w-3 h-3 mr-1" />
                      {t('branchProtected')}
                    </Badge>
                  )}
                </div>

                {branch.latest_commit && (
                  <div className="flex items-center gap-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    <span className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs border border-zinc-200 dark:border-zinc-700">
                      {branch.commit_sha.slice(0, 7)}
                    </span>
                    <span className="truncate max-w-xs">
                      {branch.latest_commit.message.split('\n')[0]}
                    </span>
                    <span className="flex-shrink-0">
                      {formatDetailedRelativeDate(branch.latest_commit.date)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {!branch.is_default && (
                  <button
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                    onClick={() => handleSetDefault(branch.name)}
                    disabled={actionLoading === branch.name}
                    title={t('branchSetDefault')}
                  >
                    {actionLoading === branch.name ? (
                      <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Icons.Star className="w-4 h-4" />
                    )}
                  </button>
                )}
                {!branch.is_default && !branch.is_protected && (
                  <button
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                    onClick={() => handleDelete(branch.name)}
                    disabled={actionLoading === branch.name}
                    title={t('branchDelete')}
                  >
                    {actionLoading === branch.name ? (
                      <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Icons.Trash className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
